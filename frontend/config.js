window.APP_CONFIG = window.APP_CONFIG || {};

const isLocalHost = ["127.0.0.1", "localhost", ""].includes(window.location.hostname)
    || window.location.protocol === "file:";

// Use the local Flask API during local development and keep the deployed API for production.
window.APP_CONFIG.API_URL = window.APP_CONFIG.API_URL || (
    isLocalHost
        ? "http://127.0.0.1:5000"
        : "https://doctor-appointment-booking-system-7z1k.onrender.com"
);
