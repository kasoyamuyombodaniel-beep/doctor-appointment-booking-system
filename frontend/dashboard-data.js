// @ts-nocheck

const appointmentStatusRequests = new Set();
let availabilitySaveInProgress = false;
let appointmentCreateInProgress = false;

/* ===================================================
   APPOINTMENT DATA LOADERS
   Fetch appointments for patient, admin, and doctor views
=================================================== */

async function loadAppointments() {
    try {
        const response = await fetch(`${API_URL}/appointments`, {
            headers: { "Authorization": token }
        });
        const appointments = await response.json();
        if (!response.ok) return;

        patientAppointments = Array.isArray(appointments) ? appointments : [];
        derivePatientContent();
        renderPatientOverview();
        renderAppointmentsList(patientAppointments);
    } catch (error) {
        console.error("Error loading appointments:", error);
    }
}

async function loadAllAppointments() {
    try {
        const response = await fetch(`${API_URL}/admin/appointments`, {
            headers: { "Authorization": token }
        });
        const appointments = await response.json();
        if (!response.ok) return;

        allAppointments = Array.isArray(appointments) ? appointments : [];
        renderAppointmentsList(allAppointments);
    } catch (error) {
        console.error("Error loading admin appointments:", error);
    }
}

async function loadDoctorAppointments() {
    try {
        const response = await fetch(`${API_URL}/doctor/appointments`, {
            headers: { "Authorization": token }
        });
        const appointments = await response.json();
        if (!response.ok) return;

        doctorAppointments = Array.isArray(appointments) ? appointments : [];
        renderDoctorAppointmentTable();
        deriveDoctorContent();
        renderDoctorCalendar();
    } catch (error) {
        console.error("Error loading doctor appointments:", error);
    }
}

/* ===================================================
   DERIVED DASHBOARD CONTENT
   Transform API payloads into counters, inbox items, and overview cards
=================================================== */

function derivePatientContent() {
    // Convert raw appointments into inbox previews, activity items, and card counters.
    const sortedAppointments = [...patientAppointments].sort(compareAppointmentDateTime);
    inboxMessages = sortedAppointments.map((appointment, index) => ({
        id: appointment.id,
        title: getPatientMessageTitle(appointment),
        preview: getPatientMessagePreview(appointment),
        content: getPatientMessageContent(appointment),
        doctorName: appointment.doctor_name || `Doctor #${appointment.doctor_id}`,
        createdAt: `${appointment.appointment_date} ${appointment.appointment_time}`,
        unread: appointment.status === "PENDING" && index < 2
    }));

    recentActivity = sortedAppointments.slice(0, 5).map(appointment => ({
        id: appointment.id,
        label: getActivityLabel(appointment),
        meta: `${appointment.appointment_date} at ${appointment.appointment_time}`
    }));

    setText("statTotal", patientAppointments.filter(isUpcomingAppointment).length);
    setText("statPending", patientAppointments.filter(item => item.status === "PENDING").length);
    setText("statApproved", patientAppointments.filter(item => item.status === "APPROVED").length);
    setText("statRejected", patientAppointments.filter(item => item.status === "REJECTED").length);
    setText("notificationCounter", inboxMessages.filter(message => message.unread).length);
    setText("settingsNotificationCount", inboxMessages.filter(message => message.unread).length);
    renderInbox(inboxMessages);
    renderMedicalRecords(medicalRecords);
}

/* ===================================================
   PATIENT MEDICAL RECORDS
   Load and normalize the records shown in the patient portal
=================================================== */

async function loadPatientMedicalRecords() {
    // Medical records are only visible to patients and are fetched on demand.
    if (decoded.role !== "patient") return;

    try {
        const response = await fetch(`${API_URL}/medical-records`, {
            headers: { "Authorization": token }
        });
        const records = await response.json();
        if (!response.ok) return;

        medicalRecords = Array.isArray(records)
            ? records.map(record => ({
                id: record.id,
                name: record.document_name,
                date: record.created_at,
                doctor: record.doctor_name,
                type: record.record_type,
                size: record.file_size
            }))
            : [];

        renderMedicalRecords(medicalRecords);
    } catch (error) {
        console.error("Error loading medical records:", error);
    }
}

function renderPatientOverview() {
    renderUpcomingAppointments(patientAppointments.filter(isUpcomingAppointment).slice(0, 3));
    renderPatientStatusOverview(patientAppointments);
    renderRecentActivity(recentActivity.slice(0, 4));
}

function renderAdminDerivedContent() {
    const pendingAppointments = allAppointments.filter(appointment => appointment.status === "PENDING");
    const pendingCount = allAppointments.filter(appointment => appointment.status === "PENDING").length;
    const approvedCount = allAppointments.filter(appointment => appointment.status === "APPROVED").length;
    const approvalRate = allAppointments.length
        ? Math.round((approvedCount / allAppointments.length) * 100)
        : 0;

    inboxMessages = pendingAppointments.slice(0, 8).map(appointment => ({
        id: appointment.id,
        title: `Appointment ${appointment.status.toLowerCase()}`,
        preview: `${appointment.patient_name || "Patient"} with ${appointment.doctor_name || "Doctor"}`,
        content: `${appointment.patient_name || "Patient"} has an appointment with ${appointment.doctor_name || "Doctor"} on ${appointment.appointment_date} at ${appointment.appointment_time}. Current status: ${appointment.status}.`,
        doctorName: appointment.doctor_name || "Doctor",
        createdAt: `${appointment.appointment_date} ${appointment.appointment_time}`,
        unread: true
    }));

    recentActivity = allAppointments.slice(0, 5).map(appointment => ({
        id: appointment.id,
        label: `${appointment.patient_name || "Patient"} scheduled with ${appointment.doctor_name || "Doctor"}`,
        meta: `${appointment.appointment_date} at ${appointment.appointment_time}`
    }));

    renderUpcomingAppointments(allAppointments.slice(0, 3));
    renderRecentMessages(inboxMessages.slice(0, 3));
    renderRecentActivity(recentActivity);
    renderInbox(inboxMessages);
    renderMedicalRecords([]);
    setText("notificationCounter", inboxMessages.filter(message => message.unread).length);
    setText("settingsNotificationCount", inboxMessages.filter(message => message.unread).length);
    setText("adminPendingFocus", pendingCount);
    setText("adminDoctorCount", adminDoctors.length);
    setText("adminPatientCount", adminPatients.length);
    setText("adminOpsQueueValue", `${pendingCount} pending appointments`);
    setText(
        "adminOpsQueueText",
        pendingCount
            ? "Pending requests are waiting for validation or reassignment."
            : "No pending requests. The appointment queue is currently clear."
    );
    setText("adminOpsCoverageValue", `${adminDoctors.length} doctors covering ${adminPatients.length} patients`);
    setText(
        "adminOpsCoverageText",
        adminDoctors.length
            ? "Doctor capacity and patient volume are both active in the platform."
            : "Add doctors to start distributing patient demand across the system."
    );
    setText("adminOpsApprovalValue", `${approvalRate}%`);
    setText(
        "adminOpsApprovalText",
        allAppointments.length
            ? "Share of recorded appointments already moved into the approved state."
            : "No appointments recorded yet, so approval performance is not available."
    );
}

function deriveDoctorContent() {
    // Rebuild the doctor overview every time appointments change.
    const sortedAppointments = [...doctorAppointments].sort(compareAppointmentDateTime);
    inboxMessages = sortedAppointments.map(appointment => ({
        id: appointment.id,
        title: appointment.status === "PENDING" ? "New appointment request" : `Appointment ${appointment.status.toLowerCase()}`,
        preview: `${appointment.patient_name} - ${appointment.appointment_date} ${appointment.appointment_time}`,
        content: `${appointment.patient_name} requested an appointment on ${appointment.appointment_date} at ${appointment.appointment_time}. Current status: ${appointment.status}.`,
        doctorName: appointment.patient_name,
        createdAt: `${appointment.appointment_date} ${appointment.appointment_time}`,
        unread: appointment.status === "PENDING"
    }));

    recentActivity = sortedAppointments.slice(0, 5).map(appointment => ({
        id: appointment.id,
        label: `${appointment.patient_name} appointment is ${appointment.status.toLowerCase()}`,
        meta: `${appointment.appointment_date} at ${appointment.appointment_time}`
    }));

    renderUpcomingAppointments(sortedAppointments.slice(0, 3));
    renderRecentMessages(inboxMessages.slice(0, 3));
    renderRecentActivity(recentActivity);
    renderInbox(inboxMessages);
    renderMedicalRecords([]);
    setText("notificationCounter", inboxMessages.filter(message => message.unread).length);
    setText("settingsNotificationCount", inboxMessages.filter(message => message.unread).length);
    setText("statLabelPrimary", "Total Appointments");
    setText("statLabelSecondary", "Pending");
    setText("statLabelTertiary", "Approved");
    setText("statLabelQuaternary", "Rejected");
    setText("statTotal", doctorAppointments.length);
    setText("statPending", doctorAppointments.filter(item => item.status === "PENDING").length);
    setText("statApproved", doctorAppointments.filter(item => item.status === "APPROVED").length);
    setText("statRejected", doctorAppointments.filter(item => item.status === "REJECTED").length);

    if (currentProfile?.full_name) {
        setText(
            "welcomeText",
            `Welcome back, Dr. ${normalizeDoctorDisplayName(currentProfile.full_name)}. Doctor ID #${currentProfile.id || decoded.user_id} - ${doctorAppointments.length} appointments`
        );
    }
}

/* ===================================================
   DOCTOR APPOINTMENT VIEW
   Delivery summary, doctor table, and calendar widgets
=================================================== */

function refreshDeliveryPanelFromDoctorAppointment(appointmentId) {
    return;
}

function renderDoctorAppointmentTable() {
    const tableBody = document.querySelector("#appointmentsTable tbody");
    if (!tableBody) return;

    tableBody.innerHTML = "";

    if (!doctorAppointments.length) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5">No appointments found</td>
            </tr>
        `;
        return;
    }

    doctorAppointments.forEach(appointment => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${escapeHtml(appointment.appointment_date)}</td>
            <td>${escapeHtml(appointment.appointment_time)}</td>
            <td>${escapeHtml(appointment.patient_name || "Patient")}</td>
            <td class="status ${escapeHtml(appointment.status)}">${formatStatusLabel(appointment.status)}</td>
            <td class="doctor-actions-cell">
                ${appointment.status === "PENDING" ? `
                    <button class="action-btn approve-btn" onclick="updateStatus(${appointment.id}, 'APPROVED')">Approve</button>
                    <button class="action-btn reject-btn" onclick="updateStatus(${appointment.id}, 'REJECTED')">Reject</button>
                ` : buildStoredDeliverySummary(appointment)}
            </td>
        `;
        tableBody.appendChild(row);
    });
}

function buildStoredDeliverySummary(appointment) {
    return "";
}

function getStoredDeliveryLabel(item) {
    const state = String(item.delivery_state || item.provider_status || "").toLowerCase();
    if (!item.sent) return "Failed";
    if (state === "queued" || state === "accepted") return "Queued";
    if (state === "delivered") return "Delivered";
    if (state === "sent") return "Sent";
    return "Sent";
}

function renderDoctorCalendar() {
    const container = document.getElementById("doctorCalendar");
    if (!container) return;

    const grouped = {};
    doctorAppointments.slice(0, 12).forEach(appointment => {
        const day = appointment.appointment_date;
        if (!grouped[day]) grouped[day] = [];
        grouped[day].push(appointment);
    });

    const days = Object.entries(grouped).slice(0, 7);
    if (!days.length) {
        container.innerHTML = `<div class="empty-message">No scheduled appointments in the current view.</div>`;
        return;
    }

    container.innerHTML = days.map(([day, items]) => `
        <div class="doctor-calendar-day">
            <strong>${escapeHtml(formatSlotDay(day))}</strong>
            <span>${escapeHtml(day)}</span>
            ${items.slice(0, 3).map(item => `
                <div class="doctor-calendar-item">
                    <span>${escapeHtml(item.appointment_time)}</span>
                    <small>${escapeHtml(item.patient_name || "Patient")}</small>
                </div>
            `).join("")}
        </div>
    `).join("");
}

/* ===================================================
   DOCTOR PATIENTS AND REPORTS
   Search, render, and summarize the doctor's patient/report data
=================================================== */

async function loadDoctorPatients(searchQuery = "") {
    if (decoded.role !== "doctor") return;

    try {
        const suffix = searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : "";
        const response = await fetch(`${API_URL}/doctor/patients${suffix}`, {
            headers: { "Authorization": token }
        });
        const patients = await response.json();
        if (!response.ok) return;

        doctorPatients = Array.isArray(patients)
            ? patients.map(patient => ({
                name: patient.patient_name,
                age: patient.age,
                lastVisit: patient.last_visit,
                status: patient.clinical_status
            }))
            : [];

        paintDoctorPatients(doctorPatients);
    } catch (error) {
        console.error("Error loading doctor patients:", error);
    }
}

function filterDoctorPatients() {
    const query = (document.getElementById("patientSearch")?.value || "").trim().toLowerCase();
    if (!query) {
        paintDoctorPatients(doctorPatients);
        return;
    }

    const filtered = doctorPatients.filter(patient =>
        [patient.name, patient.age, patient.lastVisit, patient.status].join(" ").toLowerCase().includes(query)
    );

    paintDoctorPatients(filtered);
}

function paintDoctorPatients(patients) {
    const tbody = document.getElementById("doctorPatientsBody");
    if (!tbody) return;

    if (!patients.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4">No patients found.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = patients.map(patient => `
        <tr>
            <td>${escapeHtml(patient.name)}</td>
            <td>${escapeHtml(patient.age)}</td>
            <td>${escapeHtml(patient.lastVisit)}</td>
            <td><span class="status ${patient.status.toUpperCase().replace(/ /g, "_")}">${escapeHtml(patient.status)}</span></td>
        </tr>
    `).join("");
}

async function loadDoctorReports() {
    if (decoded.role !== "doctor") return;

    try {
        const response = await fetch(`${API_URL}/doctor/reports`, {
            headers: { "Authorization": token }
        });
        const reportData = await response.json();
        if (!response.ok) return;

        setText("reportNewPatients", reportData.summary?.new_patients || 0);
        setText("reportCompletedAppointments", reportData.summary?.appointments_completed || 0);
        setText("reportPrescriptions", reportData.summary?.pending_requests || 0);
        setText("reportWaitTime", `${reportData.summary?.average_wait_time || 0} min`);

        const typeBreakdown = document.getElementById("reportTypeBreakdown");
        if (typeBreakdown) {
            const reportTypes = reportData.appointment_types || [];
            typeBreakdown.innerHTML = reportTypes.map(item => `
            <div class="report-list-item">
                <span>${escapeHtml(item.label)}</span>
                <strong class="report-list-value">${escapeHtml(item.value)}</strong>
            </div>
        `).join("");
        }

        const reportModules = document.getElementById("reportModules");
        if (reportModules) {
            const modules = reportData.modules || [];
            reportModules.innerHTML = modules.map(item => `
            <div class="report-list-item">
                <span>${escapeHtml(item.label)}</span>
                ${String(item.status || "").toLowerCase() === "ready"
                    ? `<button class="report-module-button report-module-button-ready" type="button" data-label="${escapeHtml(item.label)}" data-status="${escapeHtml(item.status)}" onclick="handleReportModuleClick(this.dataset.label, this.dataset.status)">Ready</button>`
                    : `<strong class="report-list-value">${escapeHtml(item.status)}</strong>`}
            </div>
        `).join("");
        }
    } catch (error) {
        console.error("Error loading doctor reports:", error);
    }
}

function handleReportModuleClick(label, status) {
    const normalizedStatus = String(status || "").trim().toLowerCase();
    if (normalizedStatus !== "ready") return;
    openReportModuleDetail(label, status);
}

function openReportModuleDetail(label, status) {
    const modal = document.getElementById("reportModuleModal");
    const content = document.getElementById("reportModuleContent");
    if (!modal || !content) return;

    const moduleDetails = {
        "Appointment trends": {
            summary: "Review how appointment demand evolves over time so you can identify busy periods and adjust your schedule.",
            highlights: [
                "Track peak booking periods and repeated rush hours.",
                "Compare pending requests with completed consultations.",
                "Use demand patterns to refine your weekly availability."
            ]
        },
        "Prescription history": {
            summary: "Follow the volume of prescriptions linked to your approved appointments and monitor medication workflow activity.",
            highlights: [
                "Spot periods with higher prescription output.",
                "Cross-check treatment activity with completed visits.",
                "Keep an overview of prescription-related workload."
            ]
        },
        "Diagnosis reports": {
            summary: "Use diagnosis reporting to organize clinical observations and maintain a clearer overview of patient case trends.",
            highlights: [
                "Group frequent diagnosis categories.",
                "Monitor repeated clinical patterns in your patient base.",
                "Support better follow-up planning for recurring conditions."
            ]
        },
        "Patient feedback": {
            summary: "Patient feedback modules help you evaluate service quality, communication clarity, and the overall care experience.",
            highlights: [
                "Identify recurring patient satisfaction signals.",
                "Spot areas where communication can improve.",
                "Use feedback trends to refine patient experience."
            ]
        },
        "Billing summary": {
            summary: "Billing summaries provide a lightweight financial snapshot of the care activity associated with your dashboard modules.",
            highlights: [
                "Review high-level billing-related activity.",
                "See how appointment flow can affect financial reporting.",
                "Keep operational and reporting information aligned."
            ]
        },
        "Custom report creation": {
            summary: "Custom report creation is the flexible workspace for combining metrics, filters, and focused clinical reporting needs.",
            highlights: [
                "Build tailored reports around your workflow priorities.",
                "Combine appointment, patient, and module data in one view.",
                "Prepare role-specific summaries for future dashboard expansion."
            ]
        }
    };

    const detail = moduleDetails[label] || {
        summary: "This report module is available and ready to be explored from the doctor dashboard.",
        highlights: [
            "The module is connected to the reporting area.",
            "It can support doctor-facing workflow visibility.",
            "You can use it as part of your dashboard review process."
        ]
    };

    content.innerHTML = `
        <div class="report-module-header">
            <p class="detail-label">Detailed Report Module</p>
            <h3>${escapeHtml(label)}</h3>
            <span class="report-module-status-badge">${escapeHtml(status)}</span>
        </div>
        <div class="report-module-body">
            <div class="report-module-summary">
                <strong>Overview</strong>
                <p>${escapeHtml(detail.summary)}</p>
            </div>
            <div class="report-module-insights">
                <strong>What this module helps you do</strong>
                <div class="report-module-points">
                    ${detail.highlights.map(item => `
                        <article class="report-module-point">
                            <span class="report-module-point-marker"></span>
                            <p>${escapeHtml(item)}</p>
                        </article>
                    `).join("")}
                </div>
            </div>
        </div>
    `;

    modal.style.display = "flex";
}

function closeReportModuleDetail() {
    const modal = document.getElementById("reportModuleModal");
    const content = document.getElementById("reportModuleContent");
    if (content) {
        content.innerHTML = "";
    }
    if (modal) {
        modal.style.display = "none";
    }
}

/* ===================================================
   APPOINTMENT LIST RENDERING
   Shared list rendering for patient, admin, and doctor workflows
=================================================== */

function renderAppointmentsList(appointments) {
    const list = document.getElementById("appointmentsList");
    if (!list) return;

    list.innerHTML = "";
    let filteredAppointments = filterAppointmentsBySearch(appointments, currentSearchQuery);

    if (!filteredAppointments.length) {
        list.innerHTML = `<div class="empty-message">No appointments found.</div>`;
        return;
    }

    if (decoded.role === "patient") {
        if (currentPatientStatusFilter) {
            filteredAppointments = filteredAppointments.filter(
                appointment => appointment.status === currentPatientStatusFilter
            );
        }

        if (!filteredAppointments.length) {
            list.innerHTML = `<div class="empty-message">No appointments found.</div>`;
            return;
        }

        renderPatientAppointmentsBoard(
            list,
            filteredAppointments,
            currentPatientStatusFilter ? [currentPatientStatusFilter] : null
        );
        return;
    }

    filteredAppointments.forEach(appointment => {
        const card = document.createElement("article");
        card.className = "appointment-record";
        card.innerHTML = buildAppointmentCardMarkup(appointment);
        list.appendChild(card);
    });
}

/* ===================================================
   PATIENT APPOINTMENT BOARDS
   Status overview cards, grouped columns, and detail modal
=================================================== */

function renderPatientStatusOverview(appointments) {
    const container = document.getElementById("recentMessages");
    if (!container) return;

    const grouped = buildAppointmentGroups(appointments);
    const sections = [
        { key: "PENDING", label: "Pending", helper: "Waiting for decision" },
        { key: "APPROVED", label: "Approved", helper: "Ready to attend" },
        { key: "REJECTED", label: "Rejected", helper: "Needs another slot" }
    ];

    container.innerHTML = `
        <div class="patient-status-grid">
            ${sections.map(section => `
                <button class="patient-status-card patient-status-${section.key.toLowerCase()}" type="button" onclick="openPatientAppointmentsByStatus('${section.key}')">
                    <span class="patient-status-label">${escapeHtml(section.label)}</span>
                    <strong>${grouped[section.key].length}</strong>
                    <small>${escapeHtml(section.helper)}</small>
                </button>
            `).join("")}
        </div>
    `;
}

function renderPatientAppointmentsBoard(container, appointments, visibleStatuses = null) {
    const grouped = buildAppointmentGroups(appointments);
    const allSections = [
        { key: "APPROVED", label: "Approved Appointments" },
        { key: "PENDING", label: "Pending Appointments" },
        { key: "REJECTED", label: "Rejected Appointments" }
    ];
    const sections = Array.isArray(visibleStatuses) && visibleStatuses.length
        ? allSections.filter(section => visibleStatuses.includes(section.key))
        : allSections;

    container.innerHTML = `
        <div class="patient-appointments-board">
            ${sections.map(section => `
                <section class="patient-appointments-column patient-appointments-${section.key.toLowerCase()}">
                    <div class="patient-appointments-column-header">
                        <h4>${escapeHtml(section.label)}</h4>
                        <span>${grouped[section.key].length}</span>
                    </div>
                    <div class="patient-appointments-column-body">
                        ${grouped[section.key].length
                            ? grouped[section.key].map(appointment => buildPatientAppointmentCard(appointment)).join("")
                            : `<div class="empty-message">No ${section.label.toLowerCase()}.</div>`}
                    </div>
                </section>
            `).join("")}
        </div>
    `;
}

function buildPatientAppointmentCard(appointment) {
    const doctorName = appointment.doctor_name || `Doctor #${appointment.doctor_id}`;
    const specialty = appointment.doctor_specialty || "General Consultation";

    return `
        <article class="patient-appointment-card" role="button" tabindex="0" onclick="openAppointmentDetail(${appointment.id})" onkeydown="handleAppointmentCardKeydown(event, ${appointment.id})">
            <div class="patient-appointment-card-top">
                <strong>${escapeHtml(doctorName)}</strong>
                <span class="status ${escapeHtml(appointment.status)}">${formatStatusLabel(appointment.status)}</span>
            </div>
            <p class="patient-appointment-specialty">${escapeHtml(specialty)}</p>
            <p class="appointment-meta"><i class="fa-regular fa-calendar"></i> ${escapeHtml(appointment.appointment_date)}</p>
            <p class="appointment-meta"><i class="fa-regular fa-clock"></i> ${escapeHtml(appointment.appointment_time)}</p>
        </article>
    `;
}

function buildAppointmentGroups(appointments) {
    return {
        APPROVED: appointments.filter(appointment => appointment.status === "APPROVED"),
        PENDING: appointments.filter(appointment => appointment.status === "PENDING"),
        REJECTED: appointments.filter(appointment => appointment.status === "REJECTED")
    };
}

function openPatientAppointmentsByStatus(status) {
    if (decoded.role !== "patient") return;

    currentPatientStatusFilter = status || null;
    currentSearchQuery = "";
    const searchInput = document.getElementById("appointmentSearch");
    if (searchInput) {
        searchInput.value = "";
    }

    showSection("appointments");
    renderAppointmentsList(patientAppointments);
}

function handleAppointmentCardKeydown(event, appointmentId) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openAppointmentDetail(appointmentId);
}

function openAppointmentDetail(appointmentId) {
    if (decoded.role !== "patient") return;

    const appointment = patientAppointments.find(item => item.id === appointmentId);
    const modal = document.getElementById("appointmentDetailModal");
    const content = document.getElementById("appointmentDetailContent");
    if (!appointment || !modal || !content) return;

    const doctorName = appointment.doctor_name || `Doctor #${appointment.doctor_id}`;
    const specialty = appointment.doctor_specialty || "General Consultation";
    const deliveryDetails = parseNotificationDetails(appointment.notification_delivery_details);

    content.innerHTML = `
        <div class="appointment-detail-header">
            <p class="detail-label">Appointment Detail</p>
            <h3>${escapeHtml(doctorName)}</h3>
            <span class="status ${escapeHtml(appointment.status)}">${formatStatusLabel(appointment.status)}</span>
        </div>

        <div class="appointment-detail-grid">
            <div class="appointment-detail-card">
                <span class="detail-label">Specialty</span>
                <strong>${escapeHtml(specialty)}</strong>
            </div>
            <div class="appointment-detail-card">
                <span class="detail-label">Date</span>
                <strong>${escapeHtml(appointment.appointment_date)}</strong>
            </div>
            <div class="appointment-detail-card">
                <span class="detail-label">Time</span>
                <strong>${escapeHtml(appointment.appointment_time)}</strong>
            </div>
            <div class="appointment-detail-card">
                <span class="detail-label">Status</span>
                <strong>${escapeHtml(formatStatusLabel(appointment.status))}</strong>
            </div>
        </div>

        ${deliveryDetails.length ? `
            <div class="appointment-detail-delivery">
                <span class="detail-label">Notification Status</span>
                ${buildStoredDeliverySummary(appointment)}
            </div>
        ` : ""}

        <div class="appointment-detail-actions">
            ${appointment.status !== "REJECTED" ? `
                <button class="mini-btn" type="button" onclick="closeAppointmentDetail(); rescheduleAppointment(${appointment.id}, ${appointment.doctor_id})">Reschedule</button>
            ` : ""}
            ${appointment.status === "PENDING" ? `
                <button class="mini-btn danger-btn" type="button" onclick="closeAppointmentDetail(); cancelAppointment(${appointment.id})">Cancel</button>
            ` : ""}
        </div>
    `;

    modal.style.display = "flex";
}

function closeAppointmentDetail() {
    const modal = document.getElementById("appointmentDetailModal");
    const content = document.getElementById("appointmentDetailContent");
    if (content) {
        content.innerHTML = "";
    }
    if (modal) {
        modal.style.display = "none";
    }
}

/* ===================================================
   APPOINTMENT CARDS AND FILTERS
   Build markup, search, and status-based filtering
=================================================== */

function buildAppointmentCardMarkup(appointment) {
    const doctorName = appointment.doctor_name || `Doctor #${appointment.doctor_id}`;
    const specialty = appointment.doctor_specialty || "General Consultation";
    const deliveryDetails = parseNotificationDetails(appointment.notification_delivery_details);
    const patientLine = appointment.patient_name
        ? `<p class="appointment-meta"><i class="fa-regular fa-user"></i> ${escapeHtml(appointment.patient_name)}</p>`
        : "";
    const adminScopeLine = decoded.role === "admin"
        ? `<p class="appointment-meta"><i class="fa-solid fa-hospital-user"></i> Appointment #${escapeHtml(appointment.id)} - ${escapeHtml(appointment.patient_name || "Patient")} with ${escapeHtml(doctorName)}</p>`
        : "";
    const location = `Room ${100 + ((appointment.doctor_id || 1) % 7) * 10 + 2}`;

    let actions = "";
    if (decoded.role === "patient") {
        actions = `
            <div class="appointment-actions">
                <button class="mini-btn" type="button" onclick="rescheduleAppointment(${appointment.id}, ${appointment.doctor_id})">Reschedule</button>
                <button class="mini-btn danger-btn" type="button" onclick="cancelAppointment(${appointment.id})">Cancel</button>
            </div>
        `;
    } else if (decoded.role === "admin") {
        actions = `
            <div class="appointment-actions">
                <button class="mini-btn danger-btn" type="button" onclick="deleteAppointmentByAdmin(${appointment.id})">Delete</button>
            </div>
        `;
    }

    return `
        <div class="appointment-record-header">
            <div>
                <h4>${escapeHtml(doctorName)}</h4>
                <p class="appointment-subtext">${escapeHtml(specialty)}</p>
            </div>
            <span class="status ${escapeHtml(appointment.status)}">${formatStatusLabel(appointment.status)}</span>
        </div>
        <div class="appointment-record-body">
            ${adminScopeLine}
            <p class="appointment-meta"><i class="fa-regular fa-calendar"></i> ${escapeHtml(appointment.appointment_date)}</p>
            <p class="appointment-meta"><i class="fa-regular fa-clock"></i> ${escapeHtml(appointment.appointment_time)}</p>
            <p class="appointment-meta"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(location)}</p>
            ${patientLine}
        </div>
        ${deliveryDetails.length ? `
            <div class="appointment-delivery-block">
                <span class="appointment-delivery-label">Notification Status</span>
                ${buildStoredDeliverySummary(appointment)}
            </div>
        ` : ""}
        ${actions}
    `;
}

function filterVisibleAppointments() {
    const searchInput = document.getElementById("appointmentSearch");
    currentSearchQuery = (searchInput?.value || "").trim().toLowerCase();

    if (decoded.role === "admin") {
        filterAppointments(currentAdminFilter);
        return;
    }

    if (decoded.role === "patient") {
        renderAppointmentsList(patientAppointments);
    }
}

function filterAppointments(status) {
    currentAdminFilter = status;

    if (decoded.role !== "admin") return;

    const filteredAppointments = status === "ALL"
        ? allAppointments
        : allAppointments.filter(appointment => appointment.status === status);

    renderAppointmentsList(filteredAppointments);
}

/* ===================================================
   STATUS UPDATES AND DOCTOR DIRECTORY
   Approve/reject flows and doctor selection for booking
=================================================== */

async function updateStatus(appointmentId, newStatus) {
    // Shared status update flow used by doctor and admin appointment actions.
    const requestKey = `${appointmentId}:${newStatus}`;
    if (appointmentStatusRequests.has(requestKey)) {
        showToast("Status update already in progress", "info");
        return;
    }

    appointmentStatusRequests.add(requestKey);
    try {
        const response = await fetch(`${API_URL}/appointments/${appointmentId}/status`, {
            method: "PUT",
            cache: "no-store",
            headers: {
                "Content-Type": "application/json",
                "Authorization": token
            },
            body: JSON.stringify({ status: newStatus })
        });

        const data = await response.json();
        if (!response.ok) {
            showToast(data.error || "Failed to update appointment status", "error");
            return;
        }

        const notifications = Array.isArray(data.notifications) ? data.notifications : [];
        const notificationSummary = formatNotificationSummary(notifications);

        showDeliveryStatus(notifications, "Appointment notification details");
        showToast(
            notificationSummary
                ? `Appointment ${newStatus.toLowerCase()} successfully. ${notificationSummary}`
                : `Appointment ${newStatus.toLowerCase()} successfully`,
            notificationSummary.toLowerCase().includes("failed") ? "info" : "success"
        );
        await loadStats();

        if (decoded.role === "admin") {
            await loadAllAppointments();
            renderAdminDerivedContent();
        } else if (decoded.role === "doctor") {
            await loadDoctorAppointments();
            await loadDoctorPatients();
            await loadDoctorReports();
            scheduleDoctorNotificationRefresh(appointmentId);
        } else {
            await loadAppointments();
            await loadPatientMedicalRecords();
        }
    } catch (error) {
        console.error("Error updating appointment:", error);
        showToast("Unexpected error while updating appointment", "error");
    } finally {
        appointmentStatusRequests.delete(requestKey);
    }
}

async function loadDoctors() {
    // Populate the patient booking form with doctor choices from the backend.
    try {
        const response = await fetch(`${API_URL}/doctors`);
        const doctors = await response.json();
        if (!response.ok) return;

        const select = document.getElementById("doctorId");
        if (!select) return;

        select.innerHTML = '<option value="">Select Doctor</option>';

        doctors.forEach(doctor => {
            const option = document.createElement("option");
            option.value = doctor.id;
            option.textContent = `${doctor.full_name} - ${doctor.specialty}`;
            option.dataset.doctorName = doctor.full_name;
            option.dataset.doctorSpecialty = doctor.specialty;
            select.appendChild(option);
        });

        select.onchange = () => {
            selectedAppointmentSlot = null;
            renderSelectedDoctor(select);
            loadDoctorSlots(select.value);
        };
    } catch (error) {
        console.error("Error loading doctors:", error);
    }
}

/* ===================================================
   DOCTOR SLOT PICKER
   Load availability, select a slot, and track booking state
=================================================== */

function renderSelectedDoctor(selectElement) {
    const doctorCard = document.getElementById("selectedDoctorCard");
    if (!doctorCard) return;

    const selectedOption = selectElement.options[selectElement.selectedIndex];
    if (!selectedOption || !selectedOption.value) {
        doctorCard.style.display = "none";
        doctorCard.innerHTML = "";
        return;
    }

    doctorCard.style.display = "block";
    doctorCard.innerHTML = `
        <div class="selected-doctor-content">
            <span class="appointment-chip">
                <i class="fa-solid fa-user-doctor"></i>
                ${escapeHtml(selectedOption.dataset.doctorName || selectedOption.textContent)}
            </span>
            <p>${escapeHtml(selectedOption.dataset.doctorSpecialty || "")}</p>
        </div>
    `;
}

async function loadDoctorSlots(doctorId) {
    const slotsContainer = document.getElementById("doctorSlots");
    if (!slotsContainer) return;

    if (!doctorId) {
        slotsContainer.innerHTML = `<div class="empty-message">Select a doctor to load available slots.</div>`;
        return;
    }

    slotsContainer.innerHTML = `<div class="empty-message">Loading available slots...</div>`;

    try {
        const response = await fetch(`${API_URL}/doctors/${doctorId}/available-slots?ts=${Date.now()}`, {
            cache: "no-store",
            headers: { "Authorization": token }
        });
        const slotDays = await response.json();

        if (!response.ok) {
            slotsContainer.innerHTML = `<div class="empty-message">${escapeHtml(slotDays.error || "Failed to load slots.")}</div>`;
            return;
        }

        if (!slotDays.length) {
            slotsContainer.innerHTML = `<div class="empty-message">No available slots for this doctor right now.</div>`;
            return;
        }

        slotsContainer.innerHTML = slotDays.map(day => `
            <div class="slot-day">
                <p class="slot-day-title">${formatSlotDay(day.date)}</p>
                <span class="slot-date-label">${escapeHtml(day.date)}</span>
                <div class="slot-legend">
                    <span class="slot-legend-item">
                        <span class="slot-legend-swatch"></span>
                        Available
                    </span>
                    <span class="slot-legend-item slot-legend-item-selected">
                        <span class="slot-legend-swatch"></span>
                        Selected
                    </span>
                    <span class="slot-legend-item slot-legend-item-booked">
                        <span class="slot-legend-swatch"></span>
                        Already booked
                    </span>
                </div>
                <div class="slot-buttons">
                    ${day.slots.map(slot => {
                        const selected = slot.available && isSelectedSlot(day.date, slot.time);
                        return `
                            <button
                                type="button"
                                class="slot-button ${slot.available ? "" : "slot-button-booked"} ${selected ? "active" : ""}"
                                data-available="${slot.available ? "true" : "false"}"
                                data-selected="${selected ? "true" : "false"}"
                                data-date="${escapeHtml(day.date)}"
                                data-time="${escapeHtml(slot.time)}"
                                aria-disabled="${slot.available ? "false" : "true"}"
                                title="${slot.available ? (selected ? "Selected slot" : "Available slot") : "This slot is already booked"}"
                                ${slot.available ? `onclick="selectSlot(this, '${escapeText(day.date)}', '${escapeText(slot.time)}')"` : "disabled"}
                            >
                                ${escapeHtml(slot.time)}
                                ${selected ? '<span class="slot-status-tag slot-status-tag-selected">Selected</span>' : ""}
                                ${slot.available ? "" : '<span class="slot-status-tag">Booked</span>'}
                            </button>
                        `;
                    }).join("")}
                </div>
            </div>
        `).join("");
    } catch (error) {
        console.error("Error loading doctor slots:", error);
        slotsContainer.innerHTML = `<div class="empty-message">Unexpected error while loading slots.</div>`;
    }
}

/* ===================================================
   DATE / NOTIFICATION HELPERS
   Parse delivery payloads and format timestamps or slot labels
=================================================== */

function scheduleDoctorNotificationRefresh(appointmentId) {
    window.setTimeout(async () => {
        try {
            await loadDoctorAppointments();
            await loadDoctorPatients();
            await loadDoctorReports();
            refreshDeliveryPanelFromDoctorAppointment(appointmentId);
        } catch (error) {
            console.error("Error refreshing doctor notification state:", error);
        }
    }, 4000);
}

function parseNotificationDetails(rawValue) {
    if (!rawValue) return [];
    if (Array.isArray(rawValue)) return rawValue;

    try {
        const parsed = JSON.parse(rawValue);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function formatNotificationTimestamp(rawValue) {
    if (!rawValue) return "";

    const normalized = String(rawValue).replace(" ", "T");
    const parsedDate = new Date(normalized);
    if (Number.isNaN(parsedDate.getTime())) return String(rawValue);

    return parsedDate.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

function formatSlotDay(dateValue) {
    const parsedDate = new Date(`${dateValue}T00:00:00`);
    return parsedDate.toLocaleDateString("en-US", { weekday: "long" });
}

function isSelectedSlot(dateValue, timeValue) {
    return Boolean(
        selectedAppointmentSlot
        && selectedAppointmentSlot.appointment_date === dateValue
        && selectedAppointmentSlot.appointment_time === timeValue
    );
}

function selectSlot(button, dateValue, timeValue) {
    if (button.disabled) return;

    document.querySelectorAll(".slot-button").forEach(slotButton => {
        slotButton.classList.remove("active");
        slotButton.dataset.selected = "false";

        const existingTag = slotButton.querySelector(".slot-status-tag-selected");
        if (existingTag) existingTag.remove();
    });

    button.classList.add("active");
    button.dataset.selected = "true";

    if (!button.querySelector(".slot-status-tag-selected")) {
        button.insertAdjacentHTML("beforeend", '<span class="slot-status-tag slot-status-tag-selected">Selected</span>');
    }

    selectedAppointmentSlot = {
        appointment_date: dateValue,
        appointment_time: timeValue
    };
}

/* ===================================================
   APPOINTMENT CREATION / DELETION
   Create, reschedule, cancel, or delete appointments
=================================================== */

async function createAppointment() {
    if (appointmentCreateInProgress) {
        showToast("Appointment creation already in progress", "info");
        return;
    }

    const doctorId = document.getElementById("doctorId")?.value;
    if (!doctorId || !selectedAppointmentSlot) {
        showToast("Please select a doctor and one available slot", "error");
        return;
    }

    appointmentCreateInProgress = true;
    try {
        const response = await fetch(`${API_URL}/appointments`, {
            method: "POST",
            cache: "no-store",
            headers: {
                "Content-Type": "application/json",
                "Authorization": token
            },
            body: JSON.stringify({
                doctor_id: doctorId,
                appointment_date: selectedAppointmentSlot.appointment_date,
                appointment_time: selectedAppointmentSlot.appointment_time
            })
        });

        const data = await response.json();
        if (!response.ok) {
            showToast(data.error || "Failed to create appointment", "error");
            return;
        }

        if (reschedulingAppointmentId) {
            const oldAppointmentId = reschedulingAppointmentId;
            reschedulingAppointmentId = null;
            await deleteAppointmentRequest(oldAppointmentId, false, false);
            showToast("Appointment rescheduled successfully", "success");
        } else {
            showToast("Appointment created successfully. The selected slot is now marked as booked.", "success");
        }

        selectedAppointmentSlot = null;
        await loadStats();
        await loadAppointments();
        await loadPatientMedicalRecords();
        await loadDoctorSlots(doctorId);
    } catch (error) {
        console.error("Error creating appointment:", error);
        showToast("Unexpected error while creating appointment", "error");
    } finally {
        appointmentCreateInProgress = false;
    }
}

function rescheduleAppointment(appointmentId, doctorId) {
    reschedulingAppointmentId = appointmentId;
    showSection("appointments");
    showToast("Choose a new available slot to reschedule this appointment", "info");

    const doctorSelect = document.getElementById("doctorId");
    if (!doctorSelect) return;

    doctorSelect.value = String(doctorId);
    renderSelectedDoctor(doctorSelect);
    loadDoctorSlots(doctorId);
}

async function cancelAppointment(appointmentId) {
    await deleteAppointmentRequest(appointmentId, true, true);
}

async function deleteAppointmentByAdmin(appointmentId) {
    await deleteAppointmentRequest(appointmentId, true, true);
}

async function deleteAppointmentRequest(appointmentId, showSuccessToast, askConfirmation) {
    if (askConfirmation && !confirm("Delete this appointment?")) return;

    try {
        const response = await fetch(`${API_URL}/appointments/${appointmentId}`, {
            method: "DELETE",
            headers: { "Authorization": token }
        });

        const data = await response.json();
        if (!response.ok) {
            showToast(data.error || "Failed to delete appointment", "error");
            return;
        }

        if (showSuccessToast) {
            showToast("Appointment deleted successfully", "success");
        }

        await loadStats();

        if (decoded.role === "admin") {
            await loadAllAppointments();
            renderAdminDerivedContent();
        } else if (decoded.role === "patient") {
            await loadAppointments();
            await loadPatientMedicalRecords();
            const doctorId = document.getElementById("doctorId")?.value;
            if (doctorId) {
                await loadDoctorSlots(doctorId);
            }
        }
    } catch (error) {
        console.error("Error deleting appointment:", error);
        showToast("Unexpected error while deleting appointment", "error");
    }
}

/* ===================================================
   DOCTOR AVAILABILITY
   Read and persist weekly availability from the doctor settings area
=================================================== */

async function loadAvailability() {
    if (decoded.role !== "doctor") return;

    try {
        const response = await fetch(`${API_URL}/doctor/availability`, {
            cache: "no-store",
            headers: { "Authorization": token }
        });
        const availability = await response.json();
        if (!response.ok) return;

        const container = document.getElementById("availabilityList");
        if (!container) return;

        container.innerHTML = availability.map(row => `
            <div class="availability-row">
                <label class="availability-toggle">
                    <input type="checkbox" data-weekday="${row.weekday}" class="availability-active" ${row.is_active ? "checked" : ""}>
                    <span>${WEEKDAY_LABELS[row.weekday]}</span>
                </label>
                <div class="availability-time-group">
                    <input type="time" class="availability-start" data-weekday="${row.weekday}" value="${row.start_time || "09:00"}">
                    <input type="time" class="availability-end" data-weekday="${row.weekday}" value="${row.end_time || "17:00"}">
                </div>
            </div>
        `).join("");
    } catch (error) {
        console.error("Error loading availability:", error);
        showToast("Failed to load doctor availability", "error");
    }
}

async function saveAvailability() {
    if (decoded.role !== "doctor") return;
    if (availabilitySaveInProgress) {
        showToast("Availability save already in progress", "info");
        return;
    }

    const availability = WEEKDAY_LABELS.map((_, weekday) => {
        const activeInput = document.querySelector(`.availability-active[data-weekday="${weekday}"]`);
        const startInput = document.querySelector(`.availability-start[data-weekday="${weekday}"]`);
        const endInput = document.querySelector(`.availability-end[data-weekday="${weekday}"]`);
        const isActive = Boolean(activeInput?.checked);

        return {
            weekday,
            is_active: isActive,
            start_time: isActive ? (startInput?.value || "09:00") : null,
            end_time: isActive ? (endInput?.value || "17:00") : null
        };
    });

    availabilitySaveInProgress = true;
    try {
        const response = await fetch(`${API_URL}/doctor/availability`, {
            method: "PUT",
            cache: "no-store",
            headers: {
                "Content-Type": "application/json",
                "Authorization": token
            },
            body: JSON.stringify({ availability })
        });

        const data = await response.json();
        if (!response.ok) {
            showToast(data.error || "Failed to save availability", "error");
            return;
        }

        showToast("Availability updated successfully", "success");
        await loadAvailability();
    } catch (error) {
        console.error("Error saving availability:", error);
        showToast("Unexpected error while saving availability", "error");
    } finally {
        availabilitySaveInProgress = false;
    }
}

/* ===================================================
   ADMIN DOCTOR MANAGEMENT
   Load, create, update, reset, and delete doctor accounts
=================================================== */

async function loadAdminDoctors() {
    if (decoded.role !== "admin") return;

    try {
        const response = await fetch(`${API_URL}/admin/doctors`, {
            headers: { "Authorization": token }
        });
        const doctors = await response.json();
        if (!response.ok) return;
        adminDoctors = Array.isArray(doctors) ? doctors : [];

        const doctorList = document.getElementById("doctorList");
        if (!doctorList) return;

        doctorList.innerHTML = adminDoctors.length
            ? adminDoctors.map(doctor => `
                <div class="management-item">
                    <div class="management-item-body">
                        <strong>${escapeHtml(doctor.full_name)}</strong>
                        <span>${escapeHtml(doctor.specialty)} - ${escapeHtml(doctor.email)}</span>
                    </div>
                    <div class="management-item-actions">
                        <button class="mini-btn" onclick="editDoctor(${doctor.id}, '${escapeText(doctor.full_name)}', '${escapeText(doctor.specialty)}', '${escapeText(doctor.email)}')">Edit</button>
                        <button class="mini-btn danger-btn" onclick="deleteDoctor(${doctor.id})">Delete</button>
                    </div>
                </div>
            `).join("")
            : `<div class="empty-message">No doctors found.</div>`;

        renderAdminDerivedContent();
    } catch (error) {
        console.error("Error loading admin doctors:", error);
    }
}

async function submitDoctorForm() {
    const fullName = document.getElementById("doctorFullName")?.value.trim();
    const specialty = document.getElementById("doctorSpecialtyInput")?.value.trim();
    const email = document.getElementById("doctorEmail")?.value.trim();
    const password = document.getElementById("doctorPassword")?.value;

    if (!fullName || !specialty || !email || (!editingDoctorId && !password)) {
        showToast("Please complete the doctor form", "error");
        return;
    }

    try {
        const endpoint = editingDoctorId
            ? `${API_URL}/admin/doctors/${editingDoctorId}`
            : `${API_URL}/admin/doctors`;
        const method = editingDoctorId ? "PUT" : "POST";
        const payload = editingDoctorId
            ? { full_name: fullName, specialty, email }
            : { full_name: fullName, specialty, email, password };

        const response = await fetch(endpoint, {
            method,
            headers: {
                "Content-Type": "application/json",
                "Authorization": token
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok) {
            showToast(data.error || "Failed to save doctor", "error");
            return;
        }

        const wasEditing = Boolean(editingDoctorId);
        resetDoctorForm();
        await loadAdminDoctors();
        await loadDoctors();
        showToast(wasEditing ? "Doctor updated successfully" : "Doctor added successfully", "success");
    } catch (error) {
        console.error("Error saving doctor:", error);
        showToast("Unexpected error while saving doctor", "error");
    }
}

function editDoctor(id, fullName, specialty, email) {
    editingDoctorId = id;
    setText("doctorFormTitle", "Edit Doctor");
    setInputValue("doctorFullName", fullName);
    setInputValue("doctorSpecialtyInput", specialty);
    setInputValue("doctorEmail", email);
    setInputValue("doctorPassword", "");
}

function resetDoctorForm() {
    editingDoctorId = null;
    setText("doctorFormTitle", "Add Doctor");
    setInputValue("doctorFullName", "");
    setInputValue("doctorSpecialtyInput", "");
    setInputValue("doctorEmail", "");
    setInputValue("doctorPassword", "");
}

async function deleteDoctor(doctorId) {
    if (!confirm("Delete this doctor?")) return;

    try {
        const response = await fetch(`${API_URL}/admin/doctors/${doctorId}`, {
            method: "DELETE",
            headers: { "Authorization": token }
        });

        const data = await response.json();
        if (!response.ok) {
            showToast(data.error || "Failed to delete doctor", "error");
            return;
        }

        if (editingDoctorId === doctorId) resetDoctorForm();
        await loadAdminDoctors();
        await loadDoctors();
        showToast("Doctor deleted successfully", "success");
    } catch (error) {
        console.error("Error deleting doctor:", error);
        showToast("Unexpected error while deleting doctor", "error");
    }
}

/* ===================================================
   ADMIN PATIENT MANAGEMENT
   Load, edit, reset, and delete patient accounts
=================================================== */

async function loadAdminPatients() {
    if (decoded.role !== "admin") return;

    try {
        const response = await fetch(`${API_URL}/patients`, {
            headers: { "Authorization": token }
        });
        const patients = await response.json();
        if (!response.ok) return;
        adminPatients = Array.isArray(patients) ? patients : [];

        const patientList = document.getElementById("patientList");
        if (!patientList) return;

        patientList.innerHTML = adminPatients.length
            ? adminPatients.map(patient => `
                <div class="management-item">
                    <div class="management-item-body">
                        <strong>${escapeHtml(patient.full_name)}</strong>
                        <span>${escapeHtml(patient.email)}</span>
                    </div>
                    <div class="management-item-actions">
                        <button class="mini-btn" onclick="editPatient(${patient.id}, '${escapeText(patient.full_name)}', '${escapeText(patient.email)}', '${escapeText(patient.phone || "")}')">Edit</button>
                        <button class="mini-btn danger-btn" onclick="deletePatient(${patient.id})">Delete</button>
                    </div>
                </div>
            `).join("")
            : `<div class="empty-message">No patients found.</div>`;

        renderAdminDerivedContent();
    } catch (error) {
        console.error("Error loading admin patients:", error);
    }
}

async function submitPatientForm() {
    if (!editingPatientId) {
        showToast("New patients must register themselves from the Register page", "info");
        return;
    }

    const fullName = document.getElementById("patientFullName")?.value.trim();
    const email = document.getElementById("patientEmail")?.value.trim();
    const phone = document.getElementById("patientPhone")?.value.trim();
    const password = document.getElementById("patientPassword")?.value;

    if (!fullName || !email || !phone) {
        showToast("Please complete the patient form", "error");
        return;
    }

    try {
        const response = await fetch(`${API_URL}/patients/${editingPatientId}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": token
            },
            body: JSON.stringify({
                full_name: fullName,
                email,
                phone,
                password
            })
        });

        const data = await response.json();
        if (!response.ok) {
            showToast(data.error || "Failed to save patient", "error");
            return;
        }

        resetPatientForm();
        await loadAdminPatients();
        showToast("Patient updated successfully", "success");
    } catch (error) {
        console.error("Error saving patient:", error);
        showToast("Unexpected error while saving patient", "error");
    }
}

function editPatient(id, fullName, email, phone) {
    editingPatientId = id;
    setText("patientFormTitle", "Edit Patient");
    setInputValue("patientFullName", fullName);
    setInputValue("patientEmail", email);
    setInputValue("patientPhone", phone);
    setInputValue("patientPassword", "");
}

function resetPatientForm() {
    editingPatientId = null;
    setText("patientFormTitle", "Select Patient");
    setInputValue("patientFullName", "");
    setInputValue("patientEmail", "");
    setInputValue("patientPhone", "");
    setInputValue("patientPassword", "");
}

async function deletePatient(patientId) {
    if (!confirm("Delete this patient?")) return;

    try {
        const response = await fetch(`${API_URL}/patients/${patientId}`, {
            method: "DELETE",
            headers: { "Authorization": token }
        });

        const data = await response.json();
        if (!response.ok) {
            showToast(data.error || "Failed to delete patient", "error");
            return;
        }

        if (editingPatientId === patientId) resetPatientForm();
        await loadAdminPatients();
        showToast("Patient deleted successfully", "success");
    } catch (error) {
        console.error("Error deleting patient:", error);
        showToast("Unexpected error while deleting patient", "error");
    }
}

