const API_URL = window.APP_CONFIG?.API_URL || "http://127.0.0.1:5000";

async function registerPatient() {
    // Collect patient registration data from the public sign-up page.
    const full_name = document.getElementById("fullName").value.trim();
    const email = document.getElementById("email").value.trim();
    const phone = document.getElementById("phone").value.trim();
    const password = document.getElementById("password").value;

    if (!full_name || !email || !phone || !password) {
        showToast("Please complete all fields", "error");
        return;
    }

    try {
        const response = await fetch(`${API_URL}/patients`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ full_name, email, phone, password })
        });

        const data = await response.json();
        if (!response.ok) {
            document.getElementById("error").innerText = data.error || "Registration failed";
            showToast(data.error || "Registration failed", "error");
            return;
        }

        showToast("Account created successfully. You can now login.", "success");
        window.setTimeout(() => {
            window.location.href = "login.html";
        }, 1200);
    } catch (error) {
        console.error("Registration error:", error);
        showToast("Unexpected error during registration", "error");
    }
}

function togglePasswordVisibility(inputId, button) {
    const input = document.getElementById(inputId);
    if (!input || !button) return;

    const icon = button.querySelector("i");
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";

    if (icon) {
        icon.className = isPassword ? "fa-regular fa-eye-slash" : "fa-regular fa-eye";
    }

    button.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
}

function showToast(message, type = "info") {
    // Shared toast helper for registration success and error states.
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerText = message;
    container.appendChild(toast);

    window.setTimeout(() => {
        toast.classList.add("toast-hide");
        window.setTimeout(() => toast.remove(), 240);
    }, 2600);
}
