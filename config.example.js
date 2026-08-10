const CONFIG = {
  spotify: {
    clientId: 'YOUR_SPOTIFY_CLIENT_ID',
    redirectUri: 'http://127.0.0.1:8080/',
    scopes: 'user-read-currently-playing user-read-playback-state user-modify-playback-state'
  },
  weather: {
    apiKey: 'YOUR_OPENWEATHERMAP_API_KEY',
    city: 'San Juan',
    units: 'imperial' // 'imperial' for °F, 'metric' for °C
  },
  dashboard: {
    refreshInterval: 30000,     // ms between weather updates (30s)
    spotifyPollInterval: 5000   // ms between Spotify now-playing checks (5s)
  }
};
