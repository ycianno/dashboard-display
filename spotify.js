// Spotify PKCE Auth and Now Playing Logic

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize';

// State keys
const TOKEN_KEY = 'spotify_access_token';
const REFRESH_TOKEN_KEY = 'spotify_refresh_token';
const VERIFIER_KEY = 'spotify_code_verifier';
const EXPIRY_KEY = 'spotify_token_expiry';
const SCOPES_KEY = 'spotify_scopes';

class SpotifyService {
    constructor(config) {
        this.clientId = config.clientId;
        this.redirectUri = config.redirectUri;
        this.scopes = config.scopes;
    }

    // --- PKCE Auth Flow ---

    generateRandomString(length) {
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const values = crypto.getRandomValues(new Uint8Array(length));
        return values.reduce((acc, x) => acc + possible[x % possible.length], "");
    }

    async generateCodeChallenge(codeVerifier) {
        const data = new TextEncoder().encode(codeVerifier);
        const digest = await window.crypto.subtle.digest('SHA-256', data);
        return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }

    async initiateLogin() {
        // Clear old tokens to force fresh auth with new scopes
        this.logout(false);

        const codeVerifier = this.generateRandomString(64);
        window.localStorage.setItem(VERIFIER_KEY, codeVerifier);
        
        const codeChallenge = await this.generateCodeChallenge(codeVerifier);
        
        const authUrl = new URL(AUTH_ENDPOINT);
        const params = {
            response_type: 'code',
            client_id: this.clientId,
            scope: this.scopes,
            code_challenge_method: 'S256',
            code_challenge: codeChallenge,
            redirect_uri: this.redirectUri,
        };
        
        authUrl.search = new URLSearchParams(params).toString();
        window.location.href = authUrl.toString();
    }

    async handleCallback() {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        
        if (!code) return false;
        
        const codeVerifier = window.localStorage.getItem(VERIFIER_KEY);
        
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: this.redirectUri,
            client_id: this.clientId,
            code_verifier: codeVerifier
        });
        
        try {
            const response = await fetch(TOKEN_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: body
            });
            
            if (!response.ok) throw new Error('Token fetch failed');
            
            const data = await response.json();
            this.saveTokens(data);
            // Save the scopes we authenticated with
            window.localStorage.setItem(SCOPES_KEY, this.scopes);
            
            // Clean up URL
            window.history.replaceState({}, document.title, window.location.pathname);
            return true;
        } catch (error) {
            console.error('Error in callback:', error);
            return false;
        }
    }

    async refreshToken() {
        const refreshToken = window.localStorage.getItem(REFRESH_TOKEN_KEY);
        if (!refreshToken) return false;
        
        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: this.clientId
        });
        
        try {
            const response = await fetch(TOKEN_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: body
            });
            
            if (!response.ok) {
                this.logout(true);
                return false;
            }
            
            const data = await response.json();
            
            if (!data.refresh_token) {
                data.refresh_token = refreshToken;
            }
            
            this.saveTokens(data);
            return true;
        } catch (error) {
            console.error('Error refreshing token:', error);
            return false;
        }
    }

    saveTokens(data) {
        window.localStorage.setItem(TOKEN_KEY, data.access_token);
        if (data.refresh_token) {
            window.localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
        }
        const expiryTime = new Date().getTime() + (data.expires_in * 1000);
        window.localStorage.setItem(EXPIRY_KEY, expiryTime);
    }

    logout(reload = true) {
        window.localStorage.removeItem(TOKEN_KEY);
        window.localStorage.removeItem(REFRESH_TOKEN_KEY);
        window.localStorage.removeItem(EXPIRY_KEY);
        window.localStorage.removeItem(SCOPES_KEY);
        if (reload) window.location.reload();
    }

    async getValidToken() {
        const accessToken = window.localStorage.getItem(TOKEN_KEY);
        const expiryTime = window.localStorage.getItem(EXPIRY_KEY);
        
        if (!accessToken) return null;
        
        if (new Date().getTime() > (expiryTime - 60000)) {
            const refreshed = await this.refreshToken();
            if (refreshed) {
                return window.localStorage.getItem(TOKEN_KEY);
            }
            return null;
        }
        
        return accessToken;
    }

    isAuthenticated() {
        // Check if we have a token AND the scopes match what's configured
        const hasToken = !!window.localStorage.getItem(REFRESH_TOKEN_KEY);
        const storedScopes = window.localStorage.getItem(SCOPES_KEY) || '';
        const scopesMatch = storedScopes === this.scopes;
        
        if (hasToken && !scopesMatch) {
            // Scopes changed, force re-auth
            console.log('Scopes changed, clearing old tokens');
            this.logout(false);
            return false;
        }
        
        return hasToken;
    }

    // --- API Methods ---

    async getCurrentlyPlaying() {
        const token = await this.getValidToken();
        if (!token) return null;
        
        try {
            const response = await fetch(`${SPOTIFY_API_BASE}/me/player/currently-playing`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (response.status === 204) return { is_playing: false };
            if (!response.ok) {
                if (response.status === 401) await this.refreshToken();
                throw new Error(`API Error: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('Error fetching currently playing:', error);
            return null;
        }
    }

    async getQueue() {
        const token = await this.getValidToken();
        if (!token) return null;
        
        try {
            const response = await fetch(`${SPOTIFY_API_BASE}/me/player/queue`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) return null;
            return await response.json();
        } catch (error) {
            console.error('Error fetching queue:', error);
            return null;
        }
    }

    async nextTrack() {
        const token = await this.getValidToken();
        if (!token) return false;
        try {
            const res = await fetch(`${SPOTIFY_API_BASE}/me/player/next`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok || res.status === 204;
        } catch (err) { return false; }
    }

    async previousTrack() {
        const token = await this.getValidToken();
        if (!token) return false;
        try {
            const res = await fetch(`${SPOTIFY_API_BASE}/me/player/previous`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok || res.status === 204;
        } catch (err) { return false; }
    }

    async play() {
        const token = await this.getValidToken();
        if (!token) return false;
        try {
            const res = await fetch(`${SPOTIFY_API_BASE}/me/player/play`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok || res.status === 204;
        } catch (err) { return false; }
    }

    async pause() {
        const token = await this.getValidToken();
        if (!token) return false;
        try {
            const res = await fetch(`${SPOTIFY_API_BASE}/me/player/pause`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok || res.status === 204;
        } catch (err) { return false; }
    }

    async toggleShuffle(state) {
        const token = await this.getValidToken();
        if (!token) return false;
        try {
            const res = await fetch(`${SPOTIFY_API_BASE}/me/player/shuffle?state=${state}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok || res.status === 204;
        } catch (err) { return false; }
    }

    async setRepeat(state) {
        const token = await this.getValidToken();
        if (!token) return false;
        try {
            // state: 'off', 'context', 'track'
            const res = await fetch(`${SPOTIFY_API_BASE}/me/player/repeat?state=${state}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.ok || res.status === 204;
        } catch (err) { return false; }
    }
}
