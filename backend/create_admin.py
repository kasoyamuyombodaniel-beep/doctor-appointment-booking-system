# Import the database connection function
from models import get_db_connection

# Import bcrypt library for password hashing
import bcrypt


# ===================================================
# DATABASE CONNECTION
# ===================================================

# Create a connection to the database
conn = get_db_connection()

# Create a cursor to execute SQL queries
cursor = conn.cursor()


# ===================================================
# ADMIN PASSWORD SETUP
# ===================================================

# Define the admin's plain text password
password = "admin123"

# Hash the password using bcrypt before storing it in the database
# This ensures the password is stored securely and not in plain text
hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())


# ===================================================
# INSERT ADMIN USER INTO DATABASE
# ===================================================

# Insert a new admin user into the patients table
# Note: In this system, admins and patients are stored in the same table
cursor.execute("""
INSERT INTO patients (full_name, email, password, phone, role)
VALUES (%s, %s, %s, %s, %s)
""", (
    "System Admin",        # Admin full name
    "admin@test.com",      # Admin login email
    hashed.decode("utf-8"),# Store hashed password as string
    "0000000000",          # Placeholder phone number
    "admin"                # Role set to admin
))


# ===================================================
# SAVE CHANGES
# ===================================================

# Commit the transaction to save the new admin user
conn.commit()


# ===================================================
# CLOSE DATABASE CONNECTION
# ===================================================

# Close the cursor and database connection
cursor.close()
conn.close()


# Print confirmation message in the console
print("Admin created successfully!")