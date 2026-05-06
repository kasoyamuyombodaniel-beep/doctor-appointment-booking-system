# ===================================================
# IMPORTS
# ===================================================

# Standard Python modules used for environment variables and file paths
import os
import secrets
from pathlib import Path

# Flask core class used to create the web application
from flask import Flask

# Try to import Flask-Mail (optional dependency for sending emails)
# If the package is not installed, Mail will be set to None
try:
    from flask_mail import Mail
except Exception:
    Mail = None

# Import application route blueprints
from routes.auth_routes import auth_bp
from routes.patient_routes import patient_bp
from routes.appointment_routes import appointment_bp
from routes.doctor_routes import doctor_routes

# Enable Cross-Origin Resource Sharing (CORS) for frontend-backend communication
from flask_cors import CORS


# ===================================================
# LOAD ENVIRONMENT VARIABLES
# ===================================================

def load_env_file():
    """
    Load environment variables from local .env files before app startup.

    This allows configuration values (like SMTP or Twilio credentials)
    to be stored in a .env file instead of hardcoding them in the code.
    """

    # Possible locations of the .env file
    env_candidates = [
        Path(__file__).resolve().parent / ".env",          # Same folder as this file
        Path(__file__).resolve().parent.parent / ".env"    # Parent folder
    ]

    # Loop through possible .env file locations
    for env_path in env_candidates:

        # Skip if the file does not exist
        if not env_path.exists():
            continue

        # Read the .env file line by line
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()

            # Ignore empty lines, comments, or invalid lines
            if not line or line.startswith("#") or "=" not in line:
                continue

            # Split environment variable into key=value
            key, value = line.split("=", 1)
            key = key.strip()

            # Remove quotes around the value if present
            value = value.strip().strip('"').strip("'")

            # Set environment variable only if it does not already exist
            if key and key not in os.environ:
                os.environ[key] = value


# Load environment variables before initializing the Flask app
load_env_file()


def get_env_value(*names, default=None):
    """Return the first non-empty environment value from the provided names."""
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return default


# ===================================================
# APP CONFIGURATION
# Flask app setup, CORS, JWT secret, mail and Twilio
# ===================================================

# Create the Flask application instance
app = Flask(__name__)

def _get_allowed_cors_origins():
    """
    Build the allowed frontend origin list from configuration.
    """
    raw_origins = os.getenv("CORS_ALLOWED_ORIGINS", "")
    allow_all = os.getenv("CORS_ALLOW_ALL", "false").lower() == "true"

    if allow_all:
        return "*"

    if raw_origins.strip():
        return [origin.strip() for origin in raw_origins.split(",") if origin.strip()]

    return [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5000",
        "http://127.0.0.1:5000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ]


# Enable CORS only for configured frontend origins
CORS(
    app,
    resources={r"/*": {"origins": _get_allowed_cors_origins()}},
    allow_headers=["Content-Type", "Authorization"]
)


# ---------------------------------------------------
# SECURITY CONFIGURATION
# ---------------------------------------------------

# Secret key used for JWT tokens and session security
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY") or secrets.token_hex(32)

if not os.getenv("SECRET_KEY"):
    app.logger.warning("SECRET_KEY not set in environment; using an ephemeral development key.")

# Debug mode must be explicitly enabled
app.config["DEBUG"] = os.getenv("FLASK_DEBUG", "false").lower() == "true"


# ---------------------------------------------------
# EMAIL (SMTP) CONFIGURATION
# ---------------------------------------------------

# SMTP server used for sending emails
app.config["MAIL_SERVER"] = os.getenv("MAIL_SERVER", "smtp.gmail.com")

# SMTP port number (587 is standard for TLS)
app.config["MAIL_PORT"] = int(os.getenv("MAIL_PORT", "587"))

# Enable TLS encryption for secure email transmission
app.config["MAIL_USE_TLS"] = os.getenv("MAIL_USE_TLS", "true").lower() == "true"

# Enable/disable SSL encryption
app.config["MAIL_USE_SSL"] = os.getenv("MAIL_USE_SSL", "false").lower() == "true"

# Email account used to send messages
app.config["MAIL_USERNAME"] = get_env_value("MAIL_USERNAME", "EMAIL_USER")

# Email password or app password
app.config["MAIL_PASSWORD"] = get_env_value("MAIL_PASSWORD", "EMAIL_PASS")
app.config["FRONTEND_URL"] = os.getenv("FRONTEND_URL")
app.config["RESEND_API_KEY"] = get_env_value("RESEND_API_KEY", "RESEND_KEY")
app.config["RESEND_FROM_EMAIL"] = get_env_value("RESEND_FROM_EMAIL", "RESEND_FROM")
app.config["RESEND_FROM_NAME"] = os.getenv("RESEND_FROM_NAME", "Wisdom Hospital")


# Determine sender email and name for outgoing messages
mail_sender_email = get_env_value("MAIL_DEFAULT_SENDER", "MAIL_USERNAME", "EMAIL_USER")
mail_sender_name = os.getenv("MAIL_SENDER_NAME", "Wisdom Hospital").strip()

# Configure the default sender format
app.config["MAIL_DEFAULT_SENDER"] = (
    (mail_sender_name, mail_sender_email)
    if mail_sender_email and mail_sender_name
    else mail_sender_email
)


# ---------------------------------------------------
# TWILIO SMS CONFIGURATION
# ---------------------------------------------------

# Twilio account SID used for API authentication
app.config["TWILIO_ACCOUNT_SID"] = get_env_value("TWILIO_ACCOUNT_SID", "TWILIO_SID")

# Twilio authentication token
app.config["TWILIO_AUTH_TOKEN"] = get_env_value("TWILIO_AUTH_TOKEN", "TWILIO_TOKEN")

# Twilio phone number used to send SMS messages
app.config["TWILIO_PHONE_NUMBER"] = get_env_value(
    "TWILIO_PHONE_NUMBER",
    "TWILIO_FROM_NUMBER",
    "TWILIO_NUMBER"
)

# Optional default country code used to normalize local patient numbers.
app.config["DEFAULT_PHONE_COUNTRY_CODE"] = os.getenv("DEFAULT_PHONE_COUNTRY_CODE")

# Webhook URL where Twilio sends SMS delivery updates
app.config["TWILIO_STATUS_CALLBACK_URL"] = os.getenv("TWILIO_STATUS_CALLBACK_URL")


# ---------------------------------------------------
# INITIALIZE MAIL SERVICE
# ---------------------------------------------------

# Initialize Flask-Mail only if the dependency is installed
if Mail is not None:
    Mail(app)


# ===================================================
# BASIC TEST ROUTE
# ===================================================

# Simple route used to verify that the backend server is running
@app.route("/")
def home():
    """Simple health-check endpoint used to confirm the backend is running."""
    return "Backend is running"


# ===================================================
# REGISTER BLUEPRINTS
# ===================================================

# Register all route groups (blueprints) in the Flask application
app.register_blueprint(patient_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(appointment_bp)
app.register_blueprint(doctor_routes)


# ===================================================
# RUN APPLICATION
# ===================================================

# Run the Flask development server
# debug=True enables automatic reload and detailed error messages
if __name__ == "__main__":
    app.run(debug=app.config["DEBUG"])
