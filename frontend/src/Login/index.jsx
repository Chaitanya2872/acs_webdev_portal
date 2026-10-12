import { useEffect, useRef, useState } from "react";
import "./index.css";
import logo from "./logo.png";

const RESEND_SECONDS = 30;
const OTP_LENGTH = 6;

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

/* ───────────── Icons ───────────── */

const svgProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
  focusable: "false",
};

const UserIcon = () => (
  <svg {...svgProps}>
    <circle cx="12" cy="8" r="3.8" />
    <path d="M4.5 20c0-3.4 3.4-6 7.5-6s7.5 2.6 7.5 6" />
  </svg>
);

const ShieldIcon = () => (
  <svg {...svgProps}>
    <path d="M12 3 4.5 6v5.5c0 4.5 3.1 8 7.5 9.5 4.4-1.5 7.5-5 7.5-9.5V6L12 3Z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </svg>
);

const LockIcon = () => (
  <svg {...svgProps} width={15} height={15}>
    <rect x="5" y="11" width="14" height="9" rx="2.5" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

const AlertIcon = () => (
  <svg {...svgProps} width={15} height={15}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5M12 16.2v.1" />
  </svg>
);

const CheckIcon = () => (
  <svg {...svgProps} width={16} height={16}>
    <path d="m5 12 4.2 4.2L19 6.5" />
  </svg>
);

const ArrowIcon = () => (
  <svg {...svgProps} width={17} height={17} className="btn-arrow">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

const FolderIcon = () => (
  <svg {...svgProps} width={19} height={19}>
    <path d="M3.5 8a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V8Z" />
  </svg>
);

const MoreIcon = () => (
  <svg {...svgProps} width={16} height={16} fill="currentColor" stroke="none">
    <circle cx="5.5" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="18.5" cy="12" r="1.6" />
  </svg>
);

const ShareIcon = () => (
  <svg {...svgProps} width={17} height={17}>
    <path d="M7 17 17 7M8.5 7H17v8.5" />
  </svg>
);

const Spinner = () => <span className="spinner" aria-hidden="true" />;

function Login({ onSendOtp, onVerifyOtp, onResendOtp }) {
  const [employeeCode, setEmployeeCode] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState("credentials");
  const [loadingAction, setLoadingAction] = useState("");
  const [fieldErrors, setFieldErrors] = useState({
    employeeCode: "",
    otp: "",
  });
  const [formError, setFormError] = useState("");
  const [deliveryMessage, setDeliveryMessage] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  const [otpAttempts, setOtpAttempts] = useState(0);

  const employeeCodeRef = useRef(null);
  const otpRef = useRef(null);
  const didMount = useRef(false);
  const cardRef = useRef(null);
  const frameRef = useRef(0);

  useEffect(() => {
    if (step === "otp") otpRef.current?.focus();
    else employeeCodeRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return undefined;
    }

    const timer = window.setTimeout(() => {
      if (step === "otp") otpRef.current?.focus();
      else employeeCodeRef.current?.focus();
    }, 180);

    return () => window.clearTimeout(timer);
  }, [step]);

  useEffect(() => {
    if (resendSeconds <= 0) return undefined;

    const timer = window.setInterval(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  useEffect(() => () => window.cancelAnimationFrame(frameRef.current), []);

  /* Visual only: feeds a soft light that follows the pointer over the card. */
  const handlePointerMove = (event) => {
    if (event.pointerType === "touch") return;

    const card = cardRef.current;
    if (!card) return;

    const { clientX, clientY } = event;

    window.cancelAnimationFrame(frameRef.current);

    frameRef.current = window.requestAnimationFrame(() => {
      const rect = card.getBoundingClientRect();

      card.style.setProperty("--mx", `${clientX - rect.left}px`);
      card.style.setProperty("--my", `${clientY - rect.top}px`);
    });
  };

  const clearMessages = () => {
    setFormError("");
    setDeliveryMessage("");
  };

  const handleEmployeeChange = (event) => {
    setEmployeeCode(event.target.value.replace(/\s/g, ""));
    setFieldErrors((errors) => ({ ...errors, employeeCode: "" }));
    clearMessages();
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
      const invalid = document.querySelector(
        '.fawnix-auth [aria-invalid="true"]'
      );

      invalid?.focus();
    });
  };

  const sendOtp = async (event) => {
    event.preventDefault();

    const error = validateEmployeeCode(employeeCode);

    setFieldErrors((errors) => ({
      ...errors,
      employeeCode: error,
    }));

    clearMessages();

    if (error) {
      focusFirstInvalid();
      return;
    }

    const code = employeeCode.trim();

    setOtp("");
    setOtpAttempts(0);
    setResendSeconds(RESEND_SECONDS);
    setStep("otp");

    if (typeof onSendOtp !== "function") {
      setDeliveryMessage(
        "OTP entry is ready. Connect the Send OTP API to deliver the verification code."
      );
      return;
    }

    setLoadingAction("send");

    try {
      const result = await onSendOtp({
        employeeCode: code,
      });

      setDeliveryMessage(
        result?.message ||
          "OTP sent successfully to your registered contact method."
      );
    } catch (errorObject) {
      setFormError(
        normalizeError(
          errorObject,
          "We couldn't send the OTP. Check your employee code and try again."
        )
      );
    } finally {
      setLoadingAction("");
    }
  };

  const verifyOtp = async (event) => {
    event.preventDefault();

    const error = validateOtp(otp);

    setFieldErrors((errors) => ({
      ...errors,
      otp: error,
    }));

    setFormError("");

    if (error) {
      focusFirstInvalid();
      return;
    }

    if (typeof onVerifyOtp !== "function") {
      setFormError(
        "OTP verification is not connected to the authentication service yet."
      );
      return;
    }

    setLoadingAction("verify");

    try {
      await onVerifyOtp({
        employeeCode: employeeCode.trim(),
        otp: otp.trim(),
      });
    } catch (errorObject) {
      setOtpAttempts((attempts) => attempts + 1);

      setFormError(
        normalizeError(
          errorObject,
          "The OTP is incorrect or has expired. Request a new OTP and try again."
        )
      );
    } finally {
      setLoadingAction("");
    }
  };

  const resendOtp = async () => {
    if (resendSeconds > 0 || loadingAction) return;

    clearMessages();

    if (typeof onResendOtp !== "function") {
      setResendSeconds(RESEND_SECONDS);
      setOtp("");

      setDeliveryMessage(
        "Resend is ready in the UI. Connect the Resend OTP API to send a new code."
      );

      otpRef.current?.focus();
      return;
    }

    setLoadingAction("resend");

    try {
      const result = await onResendOtp({
        employeeCode: employeeCode.trim(),
      });

      setOtp("");
      setResendSeconds(RESEND_SECONDS);

      setDeliveryMessage(
        result?.message ||
          "A new OTP has been sent to your registered contact method."
      );

      otpRef.current?.focus();
    } catch (errorObject) {
      setFormError(
        normalizeError(
          errorObject,
          "We couldn't resend the OTP. Please try again."
        )
      );
    } finally {
      setLoadingAction("");
    }
  };

  const changeEmployeeCode = () => {
    if (loadingAction) return;

    setStep("credentials");
    setOtp("");
    setResendSeconds(0);
    setOtpAttempts(0);

    setFieldErrors({
      employeeCode: "",
      otp: "",
    });

    clearMessages();
  };

  const formatCountdown = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;

    return `${String(minutes).padStart(2, "0")}:${String(
      remaining
    ).padStart(2, "0")}`;
  };

  const currentCell = Math.min(otp.length, OTP_LENGTH - 1);

  return (
    <div className="login-page fawnix-auth">
      <div
        className="login-card"
        ref={cardRef}
        onPointerMove={handlePointerMove}
      >
        <div className="login-left">
          <div className="login-box">
            <div className="auth-stage">
              <section
                className="auth-panel is-active"
                aria-labelledby="signin-title"
              >
                <div className="auth-header">
                  <div className="logo">
                    <img src={logo} width={62} height={62} alt="Fawnix logo" />
                  </div>

                  <div className="auth-heading">
                    <div className="auth-kicker">
                      <span className="auth-kicker-icon">
                        <ShieldIcon />
                      </span>

                      <span>Fawnix Employee Access</span>
                    </div>

                    <h2 id="signin-title">Sign in with Fawnix</h2>

                    <p className="login-description">
                      Sign in securely with your employee code and OTP.
                    </p>
                  </div>
                </div>

                <div className="step-track" aria-hidden="true">
                  <span className="is-active" />
                  <span className={step === "otp" ? "is-active" : ""} />
                </div>

                {step === "credentials" && (
                  <form className="step-form" onSubmit={sendOtp} noValidate>
                    <div
                      className={`form-group${
                        fieldErrors.employeeCode ? " has-error" : ""
                      }`}
                    >
                      <label htmlFor="employee-code">Employee Code</label>

                      <div className="input-wrap">
                        <span className="input-icon">
                          <UserIcon />
                        </span>

                        <input
                          id="employee-code"
                          ref={employeeCodeRef}
                          type="text"
                          value={employeeCode}
                          onChange={handleEmployeeChange}
                          onBlur={() =>
                            setFieldErrors((errors) => ({
                              ...errors,
                              employeeCode:
                                validateEmployeeCode(employeeCode),
                            }))
                          }
                          placeholder="Enter your employee code"
                          autoComplete="username"
                          autoCapitalize="characters"
                          spellCheck="false"
                          aria-invalid={
                            fieldErrors.employeeCode ? "true" : "false"
                          }
                          aria-describedby={
                            fieldErrors.employeeCode
                              ? "employee-code-error"
                              : undefined
                          }
                        />
                      </div>

                      {fieldErrors.employeeCode && (
                        <p
                          className="field-error"
                          id="employee-code-error"
                          role="alert"
                        >
                          <AlertIcon />
                          {fieldErrors.employeeCode}
                        </p>
                      )}
                    </div>

                    {formError && (
                      <p className="form-error" role="alert">
                        <AlertIcon />
                        {formError}
                      </p>
                    )}

                    <button
                      className="primary-btn send-otp-btn"
                      type="submit"
                      disabled={loadingAction === "send"}
                      aria-busy={loadingAction === "send"}
                    >
                      {loadingAction === "send" && <Spinner />}
                      {loadingAction === "send" ? "Sending…" : "Send OTP"}
                      {loadingAction !== "send" && <ArrowIcon />}
                    </button>
                  </form>
                )}

                {step === "otp" && (
                  <form className="step-form" onSubmit={verifyOtp} noValidate>
                    <div
                      className="employee-summary"
                      aria-label="Employee code"
                    >
                      <span className="summary-avatar">
                        <UserIcon />
                      </span>

                      <div className="summary-text">
                        <span className="summary-label">Employee Code</span>
                        <strong>{employeeCode}</strong>
                      </div>

                      <button
                        type="button"
                        className="change-btn"
                        onClick={changeEmployeeCode}
                        disabled={Boolean(loadingAction)}
                      >
                        Change
                      </button>
                    </div>

                    <div
                      className={`form-group${
                        fieldErrors.otp ? " has-error" : ""
                      }`}
                    >
                      <div className="otp-label-row">
                        <label htmlFor="employee-otp">Enter OTP</label>

                        <button
                          type="button"
                          className="resend-btn"
                          onClick={resendOtp}
                          disabled={
                            resendSeconds > 0 || Boolean(loadingAction)
                          }
                        >
                          {resendSeconds > 0
                            ? `Resend OTP in ${formatCountdown(
                                resendSeconds
                              )}`
                            : "Resend OTP"}
                        </button>
                      </div>

                      <div className="otp-boxes">
                        {Array.from({ length: OTP_LENGTH }).map((_, index) => (
                          <span
                            key={index}
                            aria-hidden="true"
                            className={`otp-cell${
                              otp[index] ? " is-filled" : ""
                            }${index === currentCell ? " is-current" : ""}`}
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
                          onBlur={() =>
                            setFieldErrors((errors) => ({
                              ...errors,
                              otp: validateOtp(otp),
                            }))
                          }
                          placeholder="Enter OTP"
                          autoComplete="one-time-code"
                          aria-invalid={fieldErrors.otp ? "true" : "false"}
                          aria-describedby={
                            fieldErrors.otp
                              ? "employee-otp-error"
                              : "otp-help"
                          }
                        />
                      </div>

                      <p className="otp-help" id="otp-help">
                        Enter the verification code sent to your registered
                        contact method.
                      </p>

                      {fieldErrors.otp && (
                        <p
                          className="field-error"
                          id="employee-otp-error"
                          role="alert"
                        >
                          <AlertIcon />
                          {fieldErrors.otp}
                        </p>
                      )}
                    </div>

                    {deliveryMessage && (
                      <p className="delivery-message" role="status">
                        <CheckIcon />
                        {deliveryMessage}
                      </p>
                    )}

                    {formError && (
                      <p className="form-error" role="alert">
                        <AlertIcon />
                        {formError}
                      </p>
                    )}

                    {otpAttempts >= 3 && (
                      <p className="security-note">
                        Having trouble? Request a fresh OTP after the current
                        countdown finishes.
                      </p>
                    )}

                    <button
                      className="primary-btn signin-btn"
                      type="submit"
                      disabled={loadingAction === "verify"}
                      aria-busy={loadingAction === "verify"}
                    >
                      {loadingAction === "verify" && <Spinner />}
                      {loadingAction === "verify"
                        ? "Verifying…"
                        : "Verify & Sign in"}
                      {loadingAction !== "verify" && <ArrowIcon />}
                    </button>
                  </form>
                )}

                <div className="secure-note">
                  <LockIcon />
                  <span>Your Fawnix credentials are handled securely.</span>
                </div>
              </section>
            </div>
          </div>
        </div>

        <div className="login-right">
          <div className="right-content">
            <span className="small-label">YOUR FILES, YOUR SPACE</span>

            <h1>
              Upload.
              <br />
              Organize.
              <br />
              <span>Share.</span>
            </h1>

            <p className="right-description">
              Keep your documents, folders and important files organized in
              one secure workspace.
            </p>

            <div className="file-window">
              <div className="window-header">
                <div className="window-title">
                  <span>My Files</span>
                </div>

                <button type="button" className="upload-mini">
                  + Upload
                </button>
              </div>

              <div className="file-list">
                <div className="file-item">
                  <div className="file-icon folder">
                    <FolderIcon />
                  </div>

                  <div className="file-info">
                    <strong>Project Documents</strong>
                    <span>12 files · Updated today</span>
                  </div>

                  <span className="dots">
                    <MoreIcon />
                  </span>
                </div>

                <div className="file-item">
                  <div className="file-icon pdf">PDF</div>

                  <div className="file-info">
                    <strong>Quarterly_Report_2026.pdf</strong>
                    <span>4.8 MB · Shared</span>
                  </div>

                  <span className="shared">
                    <ShareIcon />
                  </span>
                </div>

                <div className="file-item">
                  <div className="file-icon pdf">PDF</div>

                  <div className="file-info">
                    <strong>Employee_Handbook.pdf</strong>
                    <span>2.1 MB · Updated yesterday</span>
                  </div>

                  <span className="dots">
                    <MoreIcon />
                  </span>
                </div>
              </div>

              <div className="storage">
                <div className="storage-top">
                  <span>Storage</span>
                  <span>7.2 GB / 10 GB</span>
                </div>

                <div className="progress">
                  <div />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;