# ===================================================
# IMPORTS
# ===================================================

# Standard Python modules used for environment variables and file paths
import os
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


# ===================================================
# APP CONFIGURATION
# Flask app setup, CORS, JWT secret, mail and Twilio
# ===================================================

# Create the Flask application instance
app = Flask(__name__)

# Enable CORS for all routes so the frontend can communicate with the backend
CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type", "Authorization"])


# ---------------------------------------------------
# SECURITY CONFIGURATION
# ---------------------------------------------------

# Secret key used for JWT tokens and session security
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "my_super_secret_key_123")


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
app.config["MAIL_USERNAME"] = os.getenv("MAIL_USERNAME")

# Email password or app password
app.config["MAIL_PASSWORD"] = os.getenv("MAIL_PASSWORD")


# Determine sender email and name for outgoing messages
mail_sender_email = os.getenv("MAIL_DEFAULT_SENDER", os.getenv("MAIL_USERNAME"))
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
app.config["TWILIO_ACCOUNT_SID"] = os.getenv("TWILIO_ACCOUNT_SID")

# Twilio authentication token
app.config["TWILIO_AUTH_TOKEN"] = os.getenv("TWILIO_AUTH_TOKEN")

# Twilio phone number used to send SMS messages
app.config["TWILIO_PHONE_NUMBER"] = os.getenv("TWILIO_PHONE_NUMBER")

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
    app.run(debug=True)