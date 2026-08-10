// Main Application Logic

document.addEventListener('DOMContentLoaded', async () => {
    const spotify = new SpotifyService(CONFIG.spotify);
    
    // Check for callback
    if (window.location.search.includes('code=')) {
        await spotify.handleCallback();
    }
    
    // UI Elements
    const el = {
        time: document.getElementById('time-display'),
        seconds: document.getElementById('seconds-display'),
        day: document.getElementById('day-display'),
        date: document.getElementById('date-display'),
        
        weatherIcon: document.getElementById('weather-icon'),
        temperature: document.getElementById('temperature'),
        weatherDesc: document.getElementById('weather-desc'),
        
        spotifyUnauth: document.getElementById('spotify-unauth'),
        spotifyPlayer: document.getElementById('spotify-player'),
        spotifyIdle: document.getElementById('spotify-idle'),
        loginBtn: document.getElementById('spotify-login-btn'),
        
        albumArt: document.getElementById('album-art'),
        trackName: document.getElementById('track-name'),
        artistName: document.getElementById('artist-name'),
        progressBarFill: document.getElementById('progress-bar-fill'),
        progressTime: document.getElementById('progress-time'),
        totalTime: document.getElementById('total-time'),
        visualizer: document.getElementById('visualizer'),
        
        btnPrev: document.getElementById('btn-prev'),
        btnPlayPause: document.getElementById('btn-play-pause'),
        btnNext: document.getElementById('btn-next'),
        btnShuffle: document.getElementById('btn-shuffle'),
        btnRepeat: document.getElementById('btn-repeat'),
        iconPlay: document.getElementById('icon-play'),
        iconPause: document.getElementById('icon-pause'),
        
        queueContainer: document.getElementById('queue-container'),
        queueList: document.getElementById('queue-list')
    };
    
    let isCurrentlyPlaying = false;
    let shuffleState = false;
    let repeatState = 'off'; // 'off', 'context', 'track'
    let currentTrackId = null;
    let progressInterval = null;
    let localProgress = 0;
    let trackDuration = 0;
    
    // --- Spotify Auth ---
    if (spotify.isAuthenticated()) {
        el.spotifyUnauth.style.display = 'none';
        el.spotifyIdle.style.display = 'flex';
        setupControls();
        startSpotifyPolling();
    } else {
        el.spotifyUnauth.style.display = 'flex';
        el.spotifyIdle.style.display = 'none';
        el.loginBtn.addEventListener('click', () => spotify.initiateLogin());
    }
    
    // --- Controls ---
    function setupControls() {
        el.btnPrev.addEventListener('click', async () => {
            await spotify.previousTrack();
            setTimeout(pollSpotify, 500);
        });
        
        el.btnNext.addEventListener('click', async () => {
            await spotify.nextTrack();
            setTimeout(pollSpotify, 500);
        });
        
        el.btnPlayPause.addEventListener('click', async () => {
            if (isCurrentlyPlaying) {
                await spotify.pause();
            } else {
                await spotify.play();
            }
            setTimeout(pollSpotify, 300);
        });
        
        el.btnShuffle.addEventListener('click', async () => {
            shuffleState = !shuffleState;
            await spotify.toggleShuffle(shuffleState);
            el.btnShuffle.classList.toggle('active', shuffleState);
        });
        
        el.btnRepeat.addEventListener('click', async () => {
            // Cycle: off -> context -> track -> off
            const cycle = { 'off': 'context', 'context': 'track', 'track': 'off' };
            repeatState = cycle[repeatState] || 'off';
            await spotify.setRepeat(repeatState);
            el.btnRepeat.classList.toggle('active', repeatState !== 'off');
        });
    }
    
    // --- Clock ---
    function updateClock() {
        const now = new Date();
        let hours = now.getHours();
        const minutes = now.getMinutes();
        const seconds = now.getSeconds();
        const isAm = hours < 12;
        hours = hours % 12 || 12;
        const amPm = isAm ? 'AM' : 'PM';
        
        el.time.textContent = `${hours}:${minutes.toString().padStart(2, '0')}`;
        el.seconds.textContent = `${seconds.toString().padStart(2, '0')} ${amPm}`;
        
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        
        el.day.textContent = days[now.getDay()];
        el.date.textContent = `${months[now.getMonth()]} ${now.getDate()}`;
    }
    
    setInterval(updateClock, 1000);
    updateClock();
    
    // --- Weather ---
    async function updateWeather() {
        if (!CONFIG.weather.apiKey || CONFIG.weather.apiKey === 'YOUR_OPENWEATHERMAP_API_KEY') {
            el.weatherDesc.textContent = '';
            el.temperature.textContent = '';
            return;
        }
        
        try {
            const url = `https://api.openweathermap.org/data/2.5/weather?q=${CONFIG.weather.city}&units=${CONFIG.weather.units}&appid=${CONFIG.weather.apiKey}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Weather fetch failed');
            const data = await res.json();
            
            el.temperature.textContent = `${Math.round(data.main.temp)}°`;
            el.weatherDesc.textContent = data.weather[0].description;
            
            const iconCode = data.weather[0].icon;
            el.weatherIcon.src = `https://openweathermap.org/img/wn/${iconCode}@2x.png`;
            el.weatherIcon.style.display = 'block';
        } catch (err) {
            el.weatherDesc.textContent = '';
        }
    }
    
    updateWeather();
    setInterval(updateWeather, CONFIG.dashboard.refreshInterval);
    
    // --- Spotify Polling ---
    function formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    
    function updateProgressUI() {
        if (trackDuration === 0) return;
        if (localProgress > trackDuration) localProgress = trackDuration;
        const percent = (localProgress / trackDuration) * 100;
        el.progressBarFill.style.width = `${percent}%`;
        el.progressTime.textContent = formatTime(localProgress);
    }
    
    async function pollSpotify() {
        const data = await spotify.getCurrentlyPlaying();
        
        if (!data || (!data.is_playing && !data.item)) {
            el.spotifyPlayer.style.display = 'none';
            el.spotifyIdle.style.display = 'flex';
            el.visualizer.classList.remove('active');
            clearInterval(progressInterval);
            currentTrackId = null;
            isCurrentlyPlaying = false;
            updatePlayPauseIcon();
            return;
        }
        
        // We have track data (might be paused)
        if (data.item) {
            el.spotifyIdle.style.display = 'none';
            el.spotifyPlayer.style.display = 'flex';
            
            isCurrentlyPlaying = data.is_playing;
            updatePlayPauseIcon();
            
            if (data.is_playing) {
                el.visualizer.classList.add('active');
            } else {
                el.visualizer.classList.remove('active');
            }
            
            // Update shuffle/repeat state from API
            if (data.shuffle_state !== undefined) {
                shuffleState = data.shuffle_state;
                el.btnShuffle.classList.toggle('active', shuffleState);
            }
            if (data.repeat_state !== undefined) {
                repeatState = data.repeat_state;
                el.btnRepeat.classList.toggle('active', repeatState !== 'off');
            }
            
            const track = data.item;
            
            if (track.id !== currentTrackId) {
                currentTrackId = track.id;
                el.trackName.textContent = track.name;
                el.artistName.textContent = track.artists.map(a => a.name).join(', ');
                el.totalTime.textContent = formatTime(track.duration_ms);
                
                if (track.album.images.length > 0) {
                    el.albumArt.src = track.album.images[0].url;
                }
                
                trackDuration = track.duration_ms;
                
                // Fetch queue on track change
                fetchQueue();
            }
            
            localProgress = data.progress_ms;
            updateProgressUI();
            
            clearInterval(progressInterval);
            if (data.is_playing) {
                progressInterval = setInterval(() => {
                    localProgress += 1000;
                    updateProgressUI();
                }, 1000);
            }
        }
    }
    
    function updatePlayPauseIcon() {
        if (isCurrentlyPlaying) {
            el.iconPlay.style.display = 'none';
            el.iconPause.style.display = 'block';
        } else {
            el.iconPlay.style.display = 'block';
            el.iconPause.style.display = 'none';
        }
    }
    
    async function fetchQueue() {
        const queueData = await spotify.getQueue();
        if (!queueData || !queueData.queue) {
            el.queueList.innerHTML = '<div class="queue-item" style="opacity:0.5;">Queue unavailable</div>';
            return;
        }
        
        const upcoming = queueData.queue.slice(0, 3);
        
        if (upcoming.length === 0) {
            el.queueList.innerHTML = '<div class="queue-item" style="opacity:0.5;">Queue empty</div>';
            return;
        }
        
        el.queueList.innerHTML = upcoming.map((track, i) => {
            const thumb = track.album && track.album.images && track.album.images.length > 0
                ? track.album.images[track.album.images.length - 1].url
                : '';
            const artists = track.artists ? track.artists.map(a => a.name).join(', ') : '';
            return `
                <div class="queue-item">
                    <span class="queue-number">${i + 1}</span>
                    ${thumb ? `<img class="queue-thumb" src="${thumb}" alt="">` : ''}
                    <div class="queue-info">
                        <div class="queue-track">${track.name}</div>
                        <div class="queue-artist">${artists}</div>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    function startSpotifyPolling() {
        pollSpotify();
        setInterval(pollSpotify, CONFIG.dashboard.spotifyPollInterval);
    }
});
