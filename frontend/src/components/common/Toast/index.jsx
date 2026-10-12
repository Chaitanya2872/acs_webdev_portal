import React, { createContext, useCallback, useContext, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import "./index.css";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
	const [toasts, setToasts] = useState([]);

	const dismiss = useCallback((id) => {
		setToasts((current) => current.filter((toast) => toast.id !== id));
	}, []);

	const notify = useCallback((message, type = "error") => {
		const id = `${Date.now()}-${Math.random()}`;
		setToasts((current) => [...current, { id, message, type }]);
		window.setTimeout(() => dismiss(id), 7000);
	}, [dismiss]);

	return (
		<ToastContext.Provider value={notify}>
			{children}
			<div className="toast-viewport" aria-live="polite" aria-relevant="additions">
				{toasts.map((toast) => {
					const Icon = toast.type === "success"
						? CheckCircle2
						: toast.type === "info"
							? Info
							: AlertCircle;
					return (
						<div
							key={toast.id}
							className={`app-toast app-toast-${toast.type}`}
							role={toast.type === "error" ? "alert" : "status"}
						>
							<Icon size={18} aria-hidden="true" />
							<span>{toast.message}</span>
							<button type="button" aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}>
								<X size={16} />
							</button>
						</div>
					);
				})}
			</div>
		</ToastContext.Provider>
	);
}

export function useToast() {
	const notify = useContext(ToastContext);
	if (!notify) throw new Error("useToast must be used inside ToastProvider.");
	return notify;
}
