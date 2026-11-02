import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CircleAlert,
  CloudUpload,
  Globe,
  Layers,
  Lock,
  ShieldCheck,
  User,
} from "lucide-react";
import "./index.css";
import logo from "../assets/fawnix-logo.png";
import laptopScene from "../assets/login-laptop.webp";

const RESEND_SECONDS = 30;
const OTP_LENGTH = 6;

const FEATURES = [
  { icon: CloudUpload, title: "Upload Documents", text: "Add and manage files securely" },
  { icon: Layers, title: "Organize by Category", text: "Keep documents well-structured" },
  { icon: Globe, title: "Publish to Website", text: "Make selected documents live" },
];

const normalizeError = (error, fallback) =>
  error?.message || (typeof error === "string" ? error : fallback);

const validateEmployeeCode = (value) => {
  const code = value.trim();

  if (!code) return "Enter your employee code.";
  if (code.length < 2) return "Enter a valid employee code.";

  return "";
};

const validateOtp = (value) => {
  if (!value.trim()) return "Enter the OTP sent to your registered contact.";
  if (!/^\d{6}$/.test(value.trim())) return "Enter the 6-digit OTP.";

  return "";
};

const formatCountdown = (seconds) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

/* Soft blue waves behind the whole page. */
const BackgroundWaves = () => (
  <svg className="login-waves" viewBox="0 0 1821 864" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="wave-deep" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#b9d1fb" />
        <stop offset="1" stopColor="#5f95f2" />
      </linearGradient>
      <linearGradient id="wave-soft" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
        <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
    </defs>
    <path d="M0 660c230-30 470 40 690 120 120 44 220 70 330 84H0Z" fill="url(#wave-deep)" opacity="0.85" />
    <path d="M0 600c260-34 520 50 760 150 130 54 230 90 340 114H0Z" fill="url(#wave-soft)" opacity="0.7" />
    <path d="M1590 0c-30 140 40 250 231 265V0Z" fill="url(#wave-deep)" opacity="0.9" />
    <path d="M590 0c140 120 330 190 560 200 200 8 380-50 520-200Z" fill="#ffffff" opacity="0.45" />
  </svg>
);

const Spinner = () => <span className="spinner" aria-hidden="true" />;

function Login({ onSendOtp, onVerifyOtp, onResendOtp }) {
  const [employeeCode, setEmployeeCode] = useState("");
  const [otp, setOtp] = useState("");
  // Employee code the current OTP was requested for; empty until a request succeeds.
  const [otpRequestedFor, setOtpRequestedFor] = useState("");
  const [loadingAction, setLoadingAction] = useState("");
  const [fieldErrors, setFieldErrors] = useState({ employeeCode: "", otp: "" });
  const [formError, setFormError] = useState("");
  const [deliveryMessage, setDeliveryMessage] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  const [otpAttempts, setOtpAttempts] = useState(0);

  const employeeCodeRef = useRef(null);
  const otpRef = useRef(null);

  const otpRequested = Boolean(otpRequestedFor);

  useEffect(() => {
    employeeCodeRef.current?.focus();
  }, []);

  useEffect(() => {
    if (resendSeconds <= 0) return undefined;

    const timer = window.setInterval(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  const handleEmployeeChange = (event) => {
    const value = event.target.value.replace(/\s/g, "");

    setEmployeeCode(value);
    setFieldErrors({ employeeCode: "", otp: "" });
    setFormError("");

    // A different employee code needs its own OTP.
    if (otpRequested && value.trim() !== otpRequestedFor) {
      setOtpRequestedFor("");
      setOtp("");
      setResendSeconds(0);
      setOtpAttempts(0);
      setDeliveryMessage("");
    }
  };

  const handleOtpChange = (event) => {
    setOtp(event.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH));
    setFieldErrors((errors) => ({ ...errors, otp: "" }));
    setFormError("");
  };

  /* Visual only: the OTP boxes are drawn from one real input. */
  const moveCaretToEnd = (event) => {
    const input = event.currentTarget;
    const end = input.value.length;

    window.requestAnimationFrame(() => input.setSelectionRange(end, end));
  };

  const focusFirstInvalid = () => {
    window.requestAnimationFrame(() => {
      document.querySelector('.fawnix-auth [aria-invalid="true"]')?.focus();
    });
  };

  const requestOtp = async () => {
    if (loadingAction || resendSeconds > 0) return;

    const error = validateEmployeeCode(employeeCode);

    setFieldErrors({ employeeCode: error, otp: "" });
    setFormError("");
    setDeliveryMessage("");

    if (error) {
      focusFirstInvalid();
      return;
    }

    const code = employeeCode.trim();
    const isResend = otpRequestedFor === code;
    const send = isResend && typeof onResendOtp === "function" ? onResendOtp : onSendOtp;

    if (typeof send !== "function") {
      setFormError("OTP delivery is not connected to the authentication service yet.");
      return;
    }

    setLoadingAction("send");

    try {
      const result = await send({ employeeCode: code });

      setOtp("");
      setOtpAttempts(0);
      setOtpRequestedFor(code);
      setResendSeconds(RESEND_SECONDS);
      setDeliveryMessage(result?.message || "OTP sent successfully to your registered contact method.");

      window.requestAnimationFrame(() => otpRef.current?.focus());
    } catch (errorObject) {
      setFormError(normalizeError(errorObject, "We couldn't send the OTP. Check your employee code and try again."));
    } finally {
      setLoadingAction("");
    }
  };

  const signIn = async (event) => {
    event.preventDefault();

    if (!otpRequested) {
      requestOtp();
      return;
    }

    const error = validateOtp(otp);

    setFieldErrors((errors) => ({ ...errors, otp: error }));
    setFormError("");

    if (error) {
      focusFirstInvalid();
      return;
    }

    if (typeof onVerifyOtp !== "function") {
      setFormError("OTP verification is not connected to the authentication service yet.");
      return;
    }

    setLoadingAction("verify");

    try {
      await onVerifyOtp({ employeeCode: otpRequestedFor, otp: otp.trim() });
    } catch (errorObject) {
      setOtpAttempts((attempts) => attempts + 1);
      setFormError(normalizeError(errorObject, "The OTP is incorrect or has expired. Request a new OTP and try again."));
    } finally {
      setLoadingAction("");
    }
  };

  const requestLabel = (() => {
    if (loadingAction === "send") return "Sending…";
    if (resendSeconds > 0) return `Resend in ${formatCountdown(resendSeconds)}`;
    return otpRequested ? "Resend OTP" : "Request OTP";
  })();

  const currentCell = Math.min(otp.length, OTP_LENGTH - 1);

  return (
    <div className="login-page fawnix-auth">
      <BackgroundWaves />

      <main className="login-canvas">
        <section className="login-intro" aria-labelledby="portal-title">
          <h1 id="portal-title">Document Portal</h1>
          <p className="login-intro-subtitle">Upload, Organize and Publish Documents for the Company Website</p>
          <span className="login-intro-rule" aria-hidden="true" />

          <ul className="login-features">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <span className="login-feature-icon"><Icon aria-hidden="true" /></span>
                <span className="login-feature-copy">
                  <strong>{title}</strong>
                  <span>{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <img
          className="login-scene"
          src={laptopScene}
          width={1485}
          height={1059}
          alt=""
          decoding="async"
          fetchPriority="high"
        />

        <section className="login-card" aria-labelledby="signin-title">
          <div className="login-brand">
            <img src={logo} width={47} height={54} alt="" />
            <span>FAWNIX</span>
          </div>

          <div className="login-kicker">
            <ShieldCheck aria-hidden="true" />
            <span>Employee Access</span>
          </div>

          <h2 id="signin-title">Login</h2>

          <p className="login-description">
            Welcome back to the document portal. Sign in with your employee code and a one-time password.
          </p>

          <form className="login-form" onSubmit={signIn} noValidate>
            <div className={`form-group${fieldErrors.employeeCode ? " has-error" : ""}`}>
              <label htmlFor="employee-code">Employee Code</label>

              <div className="code-row">
                <div className="input-wrap">
                  <User className="input-icon" aria-hidden="true" />
                  <input
                    id="employee-code"
                    ref={employeeCodeRef}
                    type="text"
                    value={employeeCode}
                    onChange={handleEmployeeChange}
                    placeholder="Enter your employee code"
                    autoComplete="username"
                    autoCapitalize="characters"
                    spellCheck="false"
                    aria-invalid={fieldErrors.employeeCode ? "true" : "false"}
                    aria-describedby={fieldErrors.employeeCode ? "employee-code-error" : undefined}
                  />
                </div>

                <button
                  type="button"
                  className="request-btn"
                  onClick={requestOtp}
                  disabled={Boolean(loadingAction) || resendSeconds > 0}
                  aria-busy={loadingAction === "send"}
                >
                  {loadingAction === "send" && <Spinner />}
                  {requestLabel}
                </button>
              </div>

              {fieldErrors.employeeCode && (
                <p className="field-error" id="employee-code-error" role="alert">
                  <CircleAlert aria-hidden="true" />
                  {fieldErrors.employeeCode}
                </p>
              )}
            </div>

            {deliveryMessage && (
              <p className="delivery-message" role="status">
                <Check aria-hidden="true" />
                {deliveryMessage}
              </p>
            )}

            <div
              className={`form-group${fieldErrors.otp ? " has-error" : ""}${otpRequested ? "" : " is-disabled"}`}
            >
              <label htmlFor="employee-otp">Enter OTP</label>

              <div className="otp-boxes">
                {Array.from({ length: OTP_LENGTH }).map((_, index) => (
                  <span
                    key={index}
                    aria-hidden="true"
                    className={`otp-cell${otp[index] ? " is-filled" : ""}${index === currentCell ? " is-current" : ""}`}
                  >
                    {otp[index] || ""}
                  </span>
                ))}

                <input
                  id="employee-otp"
                  ref={otpRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={OTP_LENGTH}
                  value={otp}
                  onChange={handleOtpChange}
                  onFocus={moveCaretToEnd}
                  onClick={moveCaretToEnd}
                  disabled={!otpRequested}
                  placeholder="Enter OTP"
                  autoComplete="one-time-code"
                  aria-invalid={fieldErrors.otp ? "true" : "false"}
                  aria-describedby={fieldErrors.otp ? "employee-otp-error" : "otp-help"}
                />
              </div>

              <p className="otp-help" id="otp-help">
                {otpRequested
                  ? "Enter the 6-digit code sent to your registered contact method."
                  : "Request an OTP to enable this field."}
              </p>

              {fieldErrors.otp && (
                <p className="field-error" id="employee-otp-error" role="alert">
                  <CircleAlert aria-hidden="true" />
                  {fieldErrors.otp}
                </p>
              )}
            </div>

            {formError && (
              <p className="form-error" role="alert">
                <CircleAlert aria-hidden="true" />
                {formError}
              </p>
            )}

            {otpAttempts >= 3 && (
              <p className="security-note">
                Having trouble? Request a fresh OTP after the current countdown finishes.
              </p>
            )}

            <button
              className="primary-btn"
              type="submit"
              disabled={!otpRequested || loadingAction === "verify"}
              aria-busy={loadingAction === "verify"}
            >
              {loadingAction === "verify" && <Spinner />}
              {loadingAction === "verify" ? "Signing in…" : "Sign in with Fawnix"}
              {loadingAction !== "verify" && <ArrowRight className="btn-arrow" aria-hidden="true" />}
            </button>
          </form>

          <div className="secure-note">
            <Lock aria-hidden="true" />
            <span>Your credentials are handled securely.</span>
          </div>
        </section>
      </main>
    </div>
  );
}

export default Login;
