async function login(){
    // Read the selected role and credentials from the login form.
    const role = document.getElementById("roleSelect").value;
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    const rememberMe = document.getElementById("rememberMe")?.checked;

    const response = await fetch("http://127.0.0.1:5000/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({role, email, password})
    });

    const data = await response.json();

    if (response.ok){
        // Keep the token across browser restarts only when "Remember me" is checked.
        if (rememberMe) {
            localStorage.setItem("token", data.token);
        } else {
            sessionStorage.setItem("token", data.token);
            localStorage.removeItem("token");
        }
        window.location.href = "dashboard.html";
    } else{
        document.getElementById("error").innerText = data.error;
        showToast(data.error || "Login failed", "error");
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

function forgotPassword(event) {
    // This simple flow collects a replacement password and sends it to the backend.
    event.preventDefault();
    const email = window.prompt("Enter the email address for the account:");
    if (!email) return;

    const newPassword = window.prompt("Enter a new password:");
    if (!newPassword) return;

    fetch("http://127.0.0.1:5000/forgot-password", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            email,
            new_password: newPassword
        })
    })
        .then(response => response.json().then(data => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
            if (!ok) {
                showToast(data.error || "Failed to reset password", "error");
                return;
            }
            showToast(data.message || "Password updated successfully", "success");
        })
        .catch(() => {
            showToast("Unexpected error while resetting password", "error");
        });
}


function showToast(message, type = "info") {
    // Reusable lightweight notification used across the auth screens.
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
