# 🏥 Doctor Appointment Booking System

A full-stack web application for managing doctor appointments with role-based access control, secure authentication, and real-time notifications.

---

## 🚀 Features

### 🔐 Authentication & Security
- JWT Authentication
- Role-Based Access Control (Admin / Doctor / Patient)
- Protected API routes
- Environment variable protection (.env not exposed)
- Secure password hashing with bcrypt

### 👨‍⚕️ Patient
- Create appointment
- View personal appointments
- Cancel pending appointments
- View personal statistics dashboard

### 👨‍⚕️ Doctor
- View assigned appointments
- Approve or reject appointments
- Real-time appointment status updates

### 👨‍💼 Admin
- View all appointments
- Update appointment status
- System-wide statistics dashboard

### 📊 Dashboard
- Total appointments
- Pending
- Approved
- Rejected
- Interactive chart using Chart.js

### 📩 Notifications
- Email notifications (SMTP)
- SMS notifications using Twilio

---

## 🛠 Tech Stack

### Backend
- Python
- Flask
- MySQL
- JWT (JSON Web Token)
- bcrypt
- Twilio API

### Frontend
- HTML
- CSS
- JavaScript
- Chart.js

---

## 🗂 Project Structure

```
backend/
frontend/
```

---

## ⚙️ Installation

```bash
git clone https://github.com/kasoyamuyombodaniel-beep/doctor-appointment-booking-system.git
cd doctor-appointment-booking-system/backend
pip install -r requirements.txt
python app.py
```

---

## 🔐 Environment Variables

Create a `.env` file inside the `backend/` folder and add:

```
SECRET_KEY=your_secret_key
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
EMAIL_USER=your_email
EMAIL_PASS=your_password
```

⚠️ Do not push the `.env` file to GitHub.

---

## 👨‍💻 Author

Daniel Kasoya  
Full-Stack Developer | Python | Flask | REST APIs
