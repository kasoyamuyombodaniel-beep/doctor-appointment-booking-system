// @ts-nocheck

/* ===================================================
   GLOBAL CONFIGURATION
   API base URL and authentication token
=================================================== */

const API_URL = "http://127.0.0.1:5000";

/* Retrieve token from browser storage */
const token = localStorage.getItem("token") || sessionStorage.getItem("token");

/* If no token exists, redirect user to login page */
if (!token) {
    window.location.href = "login.html";
}


/* ===================================================
   JWT TOKEN PARSING
   Decode JWT token to retrieve user information
=================================================== */

function parseJwt(jwtToken) {
    try {

        /* Extract payload section from JWT */
        const base64 = jwtToken.split(".")[1];

        /* Decode Base64 payload */
        const jsonPayload = decodeURIComponent(
            atob(base64)
                .split("")
                .map(char => "%" + ("00" + char.charCodeAt(0).toString(16)).slice(-2))
                .join("")
        );

        /* Convert payload into JSON object */
        return JSON.parse(jsonPayload);

    } catch (error) {

        /* If token is invalid, clear storage and redirect */
        localStorage.removeItem("token");
        window.location.href = "login.html";
        throw error;
    }
}


/* Decode JWT token once at startup */
const decoded = parseJwt(token);


/* ===================================================
   CONSTANTS
=================================================== */

/* Weekday labels used for scheduling UI */
const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];


/* ===================================================
   GLOBAL STATE VARIABLES
=================================================== */

let chartInstance = null;
let currentSection = "overview";

let allAppointments = [];
let patientAppointments = [];
let doctorAppointments = [];

let inboxMessages = [];
let medicalRecords = [];
let recentActivity = [];

let selectedAppointmentSlot = null;

let currentSearchQuery = "";
let currentAdminFilter = "ALL";

let editingDoctorId = null;
let editingPatientId = null;
let reschedulingAppointmentId = null;

let currentProfile = null;

let doctorPatients = [];
let adminDoctors = [];
let adminPatients = [];


/* ===================================================
   ROLE-BASED UI CONFIGURATION
   Adjust layout depending on user role
=================================================== */

function configureLayoutForRole() {

    /* Update titles and labels dynamically based on role */

    setText("role", prettyRole(decoded.role));
    setText("dashboardTitle", getDashboardTitle(decoded.role));
    setText("heroBannerTitle", getHeroBannerTitle(decoded.role));
    setText("heroBannerText", getHeroBannerText(decoded.role));

    const pageKicker = document.querySelector(".page-kicker");

    if (pageKicker) {
        pageKicker.innerText = getPageKicker(decoded.role);
    }

    setText("sidebarTitle", getSidebarTitle(decoded.role));
    setText("sidebarCopy", getSidebarCopy(decoded.role));

    /* Navigation labels */
    setText("navOverview", "Dashboard");
    setText("navPatients", "My Patients");
    setText("navAppointments", "Appointments");
    setText("navInbox", "Inbox");

    setText("navRecords", decoded.role === "doctor" ? "Reports" : "Medical Records");

    setText("navSettings", "Settings");

    setText(
        "appointmentsSectionTitle",
        decoded.role === "doctor"
            ? "Appointment Requests"
            : "Appointments"
    );


    /* ===================================================
       ROLE-SPECIFIC TEXT CONTENT
    =================================================== */

    if (decoded.role === "doctor") {

        setText("overviewTitle", "Your clinical dashboard");
        setText("upcomingPanelTitle", "Upcoming Consultations");
        setText("messagesPanelTitle", "Messages Preview");
        setText("activityPanelTitle", "Clinical Activity");

        setText("recordsKicker", "Reports & Analytics");
        setText("recordsTitle", "Clinical Reports");
    }

    if (decoded.role === "admin") {

        setText("overviewTitle", "Administrative overview");
        setText("upcomingPanelTitle", "Priority Appointments");
        setText("messagesPanelTitle", "Operational Alerts");
        setText("activityPanelTitle", "System Activity");

        setText("recordsKicker", "Admin Operations");
        setText("recordsTitle", "Management Center");
    }


    /* ===================================================
       VISIBILITY CONTROL FOR ROLE-SPECIFIC UI ELEMENTS
    =================================================== */

    if (decoded.role !== "admin") {
        document.querySelectorAll(".admin-only").forEach(element => {
            element.style.display = "none";
        });
    }

    if (decoded.role !== "doctor") {

        document.querySelectorAll(".doctor-only").forEach(element => {
            element.style.display = "none";
        });

        const doctorSection = document.getElementById("doctorSection");

        if (doctorSection) doctorSection.style.display = "none";

    } else {

        const doctorSection = document.getElementById("doctorSection");

        if (doctorSection) doctorSection.style.display = "block";
    }

    if (decoded.role !== "patient") {

        document.querySelectorAll(".patient-only").forEach(element => {
            element.style.display = "none";
        });

        document.querySelectorAll(".patient-only-inline").forEach(element => {
            element.style.display = "none";
        });
    }

    if (decoded.role === "patient") {

        document.querySelectorAll(".doctor-admin-only").forEach(element => {
            element.style.display = "none";
        });
    }
}


/* ===================================================
   INITIAL DATA LOADING
=================================================== */

async function loadInitialData() {

    /* Load profile and stats for all users */
    await loadProfile();
    await loadStats();

    /* Load role-specific data */

    if (decoded.role === "admin") {

        await Promise.all([
            loadAllAppointments(),
            loadAdminDoctors(),
            loadAdminPatients()
        ]);

        renderAdminDerivedContent();

    } else if (decoded.role === "patient") {

        await Promise.all([
            loadAppointments(),
            loadDoctors(),
            loadPatientMedicalRecords()
        ]);

    } else if (decoded.role === "doctor") {

        await Promise.all([
            loadDoctorAppointments(),
            loadAvailability(),
            loadDoctorPatients(),
            loadDoctorReports()
        ]);
    }
}


/* ===================================================
   ROLE FORMAT UTILITIES
=================================================== */

/* Capitalize role name */
function prettyRole(role) {
    if (!role) return "Unknown";
    return role.charAt(0).toUpperCase() + role.slice(1);
}


/* Normalize doctor name for display */
function normalizeDoctorDisplayName(name) {
    const rawName = String(name || "").trim();
    if (!rawName) return "Doctor";

    return rawName.replace(/^(dr\.?\s*)+/i, "");
}


/* ===================================================
   ROLE-SPECIFIC TEXT GENERATORS
=================================================== */

function getDashboardTitle(role) {
    if (role === "doctor") return "Doctor Dashboard";
    if (role === "patient") return "Patient Dashboard";
    return "Admin Workspace";
}

function getPageKicker(role) {
    if (role === "doctor") return "Doctor Portal";
    if (role === "patient") return "Patient Portal";
    return "Administrative Portal";
}

function getSidebarTitle(role) {
    if (role === "doctor") return "Doctor Center";
    if (role === "patient") return "Patient Center";
    return "Control Center";
}

function getSidebarCopy(role) {
    if (role === "doctor")
        return "Appointments, patients, and work hours in one place";

    if (role === "patient")
        return "Appointments, messages, and records in one place.";

    return "Appointments, doctors, patients, and activity in one place.";
}

function getHeroBannerTitle(role) {

    if (role === "doctor")
        return "Review requests, manage patients, and keep your schedule under control.";

    if (role === "patient")
        return "Track every visit, message, and medical update from one calm dashboard.";

    return "Supervise appointments, doctors, patients, and system activity from one workspace.";
}

function getHeroBannerText(role) {

    if (role === "doctor")
        return "Use one clinical workspace to approve requests, view patient history, and adjust your available hours.";

    if (role === "patient")
        return "Your dashboard keeps upcoming appointments, notifications, and medical records visible without extra navigation.";

    return "The admin workspace gives you a fast overview of the whole booking system with direct management tools.";
}


/* ===================================================
   SECTION NAVIGATION
=================================================== */

function showSection(sectionName) {

    /* Track active section */
    currentSection = sectionName;

    /* Update sidebar active state */
    document.querySelectorAll(".sidebar-nav li").forEach(item => {
        item.classList.toggle("active", item.dataset.section === sectionName);
    });

    /* Show matching dashboard section */
    document.querySelectorAll(".dashboard-section").forEach(panel => {
        panel.classList.toggle("active", panel.dataset.sectionPanel === sectionName);
    });

    /* Scroll page to top smoothly */
    window.scrollTo({ top: 0, behavior: "smooth" });
}


/* ===================================================
   PROFILE LOADING
=================================================== */

async function loadProfile() {

    try {

        const response = await fetch(`${API_URL}/profile`, {
            headers: { "Authorization": token }
        });

        const profile = await response.json();

        if (!response.ok) return;

        currentProfile = profile;

        const fullName = profile.full_name || "User";
        const avatarLetter = fullName.trim().charAt(0).toUpperCase() || "U";

        const userId = profile.id || decoded.user_id;
        const userIdLabel = `${prettyRole(decoded.role)} ID #${userId}`;

        /* Update UI fields */
        setText("welcomeText", `Welcome back, ${fullName}. ${userIdLabel}`);

        setText("profileNameMini", fullName);
        setText("profileIdMini", userIdLabel);

        setText("profileDetailId", userIdLabel);
        setText("profileDetailName", fullName);

        setText("profileDetailEmail", profile.email || "No email");
        setText("profileDetailPhone", profile.phone || "Not available");

        setText("profileDetailRole", prettyRole(decoded.role));

        setText("securityEmail", profile.email || "No email");
        setText("securityRole", prettyRole(decoded.role));

        /* Update avatar UI */
        setAvatar("profileAvatar", avatarLetter);
        setAvatar("settingsAvatar", avatarLetter);

    } catch (error) {

        console.error("Error loading profile:", error);
    }
}


/* ===================================================
   DASHBOARD STATISTICS
=================================================== */

async function loadStats() {

    try {

        const response = await fetch(`${API_URL}/appointments/stats`, {
            headers: { "Authorization": token }
        });

        const stats = await response.json();

        if (!response.ok) return;


        /* Patient dashboard statistics */
        if (decoded.role === "patient") {

            setText("statLabelPrimary", "Upcoming Appointments");
            setText("statLabelSecondary", "Unread Messages");
            setText("statLabelTertiary", "Approved");
            setText("statLabelQuaternary", "Rejected");

            setText("statTotal", stats.total || 0);
            setText("statPending", 0);
            setText("statApproved", stats.approved || 0);
            setText("statRejected", stats.rejected || 0);

            return;
        }

        /* Doctor and admin statistics */
        setText("statLabelPrimary", "Total Appointments");
        setText("statLabelSecondary", "Pending");
        setText("statLabelTertiary", "Approved");
        setText("statLabelQuaternary", "Rejected");

        setText("statTotal", stats.total || 0);
        setText("statPending", stats.pending || 0);
        setText("statApproved", stats.approved || 0);
        setText("statRejected", stats.rejected || 0);

        /* Render analytics chart */
        renderAnalyticsChart(stats);

    } catch (error) {

        console.error("Error loading stats:", error);
    }
}


/* ===================================================
   ANALYTICS CHART
=================================================== */

function renderAnalyticsChart(stats) {

    const chartCanvas = document.getElementById("appointmentsChart");

    if (!chartCanvas || typeof Chart === "undefined") return;

    /* Destroy previous chart instance */
    if (chartInstance) chartInstance.destroy();

    /* Create new chart */
    chartInstance = new Chart(chartCanvas.getContext("2d"), {

        type: "bar",

        data: {
            labels: ["Total", "Pending", "Approved", "Rejected"],

            datasets: [{
                data: [
                    stats.total || 0,
                    stats.pending || 0,
                    stats.approved || 0,
                    stats.rejected || 0
                ],

                backgroundColor: [
                    "#1f3c88",
                    "#ff9800",
                    "#4caf50",
                    "#f44336"
                ],

                borderRadius: 8
            }]
        },

        options: {
            responsive: true,

            plugins: {
                legend: { display: false }
            }
        }
    });
}
