# ===================================================
# IMPORTS
# ===================================================

# Library used to encode and decode JSON Web Tokens (JWT)
import jwt

# Flask utilities used to access request data and return JSON responses
from flask import request, jsonify, current_app

# wraps preserves the original function metadata when using decorators
from functools import wraps


def _extract_token():
    """
    Extract the JWT token from the Authorization header.

    Supports two formats:
    1) Standard Bearer token:  Authorization: Bearer <token>
    2) Raw token directly in the header
    """

    # Retrieve Authorization header from the request
    auth_header = request.headers.get("Authorization")

    # If header is missing, return None
    if not auth_header:
        return None

    # If the header starts with "Bearer ", extract the token part
    if auth_header.startswith("Bearer "):
        return auth_header.split(" ", 1)[1].strip()

    # Otherwise return the header value directly
    return auth_header


# ===================================================
# TOKEN REQUIRED DECORATOR
# Protects routes that require authentication
# ===================================================

def token_required(f):
    """
    Decorator used to protect routes that require authentication.

    Workflow:
    1) Check if a JWT token exists in the request header
    2) Decode the token using the application's SECRET_KEY
    3) Extract the user_id and role from the token payload
    4) Pass these values to the protected route function
    """

    @wraps(f)
    def decorated(*args, **kwargs):

        # Extract token from request headers
        token = _extract_token()

        # ---------------------------------------------------
        # STEP 1: Check token existence
        # ---------------------------------------------------
        if not token:
            return jsonify({"error": "Token is missing"}), 401

        try:
            # ---------------------------------------------------
            # STEP 2: Decode token using the app secret key
            # ---------------------------------------------------
            data = jwt.decode(
                token,
                current_app.config["SECRET_KEY"],
                algorithms=["HS256"]
            )

            # ---------------------------------------------------
            # STEP 3: Extract user id and role from token payload
            # ---------------------------------------------------
            user_id = data.get("user_id")
            user_role = data.get("role")

            # Ensure token contains required fields
            if not user_id or not user_role:
                return jsonify({"error": "Invalid token payload"}), 401

        # Handle expired token
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token expired"}), 401

        # Handle invalid token
        except jwt.InvalidTokenError:
            return jsonify({"error": "Invalid token"}), 401

        # ---------------------------------------------------
        # STEP 4: Pass extracted values to the route
        # ---------------------------------------------------
        return f(user_id, user_role, *args, **kwargs)

    return decorated


# ===================================================
# ADMIN REQUIRED DECORATOR
# Protects routes that require ADMIN role
# ===================================================

def admin_required(f):
    """
    Decorator used to protect routes that require admin privileges.

    Workflow:
    1) Check if a JWT token exists
    2) Decode the token
    3) Verify that the user's role is 'admin'
    """

    @wraps(f)
    def decorated(*args, **kwargs):

        # Extract token from request
        token = _extract_token()

        # Ensure token exists
        if not token:
            return jsonify({"error": "Token is missing"}), 401

        try:
            # Decode the token
            data = jwt.decode(
                token,
                current_app.config["SECRET_KEY"],
                algorithms=["HS256"]
            )

            # Verify that the role in the token is admin
            if data.get("role") != "admin":
                return jsonify({"error": "Admin access required"}), 403

        # Handle expired token
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token expired"}), 401

        # Handle invalid token
        except jwt.InvalidTokenError:
            return jsonify({"error": "Invalid token"}), 401

        # If token is valid and role is admin, allow access to the route
        return f(*args, **kwargs)

    return decorated