"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { registerUser } from "./actions";
import {
  validateEmail,
  validatePassword,
  validateMinLength,
  validateRequired,
  validateStudentNumber,
  hasErrors,
  setFieldError,
  clearFieldError,
  type FormErrors,
} from "@/lib/validators";

type Role = "student" | "faculty";

interface RegisterForm {
  [key: string]: unknown;
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  role: Role;
  studentNumber: string;
  program: string;
  yearLevel: string;
  section: string;
  employeeNumber: string;
}

export interface ProgramOption {
  id: string;
  label: string;
}
export interface YearLevelOption {
  id: string;
  label: string;
}

interface RegisterPageProps {
  programs: ProgramOption[];
  yearLevels: YearLevelOption[];
  optionsError: string | null;
}

export default function RegisterForm({
  programs,
  yearLevels,
  optionsError,
}: RegisterPageProps) {
  const router = useRouter();
  const [form, setForm] = useState<RegisterForm>({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "student",
    studentNumber: "",
    program: "",
    yearLevel: "",
    section: "",
    employeeNumber: "",
  });
  const [errors, setErrors] = useState<FormErrors<RegisterForm>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => clearFieldError(prev, name as keyof RegisterForm));
    setGeneralError(null);
  }

  function handleRoleChange(role: Role) {
    setForm((prev) => ({ ...prev, role }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next.studentNumber;
      delete next.program;
      delete next.yearLevel;
      delete next.section;
      delete next.employeeNumber;
      return next;
    });
  }

  function validate(): boolean {
    let newErrors: FormErrors<RegisterForm> = {};

    const nameResult = validateMinLength(form.fullName, 2, "Full name");
    if (!nameResult.success) {
      newErrors = setFieldError(newErrors, "fullName", nameResult.errors[0].message);
    }

    const emailResult = validateEmail(form.email);
    if (!emailResult.success) {
      newErrors = setFieldError(newErrors, "email", emailResult.errors[0].message);
    }

    const passwordResult = validatePassword(form.password);
    if (!passwordResult.success) {
      const messages = [...new Set(passwordResult.errors.map((e) => e.message))];
      newErrors = setFieldError(newErrors, "password", messages[0]);
    }

    if (form.password !== form.confirmPassword) {
      newErrors = setFieldError(newErrors, "confirmPassword", "Passwords do not match");
    }

    if (form.role === "student") {
      const snResult = validateStudentNumber(form.studentNumber);
      if (!snResult.success) {
        newErrors = setFieldError(newErrors, "studentNumber", snResult.errors[0].message);
      }

      const programResult = validateRequired(form.program, "program");
      if (!programResult.success) {
        newErrors = setFieldError(newErrors, "program", "Please select a program");
      }

      const yearResult = validateRequired(form.yearLevel, "year level");
      if (!yearResult.success) {
        newErrors = setFieldError(newErrors, "yearLevel", "Please select a year level");
      }

      const sectionResult = validateRequired(form.section, "section");
      if (!sectionResult.success) {
        newErrors = setFieldError(newErrors, "section", "Please enter your section");
      }
    } else {
      if (form.employeeNumber.trim()) {
        const enResult = validateMinLength(form.employeeNumber, 3, "Employee number");
        if (!enResult.success) {
          newErrors = setFieldError(
            newErrors,
            "employeeNumber",
            enResult.errors[0].message,
          );
        }
      }
    }

    setErrors(newErrors);
    return !hasErrors(newErrors);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGeneralError(null);

    if (!validate()) return;

    setIsLoading(true);

    const result = await registerUser({
      fullName: form.fullName,
      email: form.email,
      password: form.password,
      role: form.role,
      studentNumber: form.studentNumber,
      programId: form.program || null,
      yearLevelId: form.yearLevel || null,
      sectionName: form.section,
      employeeNumber: form.employeeNumber,
    });

    setIsLoading(false);

    if (!result.success) {
      if (result.fieldErrors) {
        setErrors((prev) => ({ ...prev, ...result.fieldErrors }));
      }
      if (result.error) {
        setGeneralError(result.error);
      }
      return;
    }

    router.push(
      result.emailSent
        ? "/register/success"
        : "/register/success?email=failed"
    );
  }

  const inputClass =
    "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-light)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="rounded-xl bg-[var(--color-surface)] p-8 shadow-lg">
      <div className="mb-6 text-center">
        <h2 className="text-xl font-semibold text-[var(--color-foreground)]">
          Create your account
        </h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Fill in the details below to get started
        </p>
      </div>

      {optionsError && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning-light)] p-3 text-xs text-[var(--color-warning)]"
        >
          Program and year-level options could not be loaded. Student registration
          may be limited — contact an administrator.
        </div>
      )}

      {generalError && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-[var(--color-danger)]/20 bg-[var(--color-danger-light)] p-3 text-sm text-[var(--color-danger)]"
        >
          {generalError}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label
            htmlFor="fullName"
            className="mb-1 block text-sm font-medium text-[var(--color-foreground)]"
          >
            Full name <span className="text-[var(--color-danger)]">*</span>
          </label>
          <input
            id="fullName"
            name="fullName"
            type="text"
            autoComplete="name"
            required
            aria-invalid={!!errors.fullName}
            aria-describedby={errors.fullName ? "fullName-error" : undefined}
            value={form.fullName}
            onChange={handleChange}
            placeholder="Juan Dela Cruz"
            className={inputClass}
            disabled={isLoading}
          />
          {errors.fullName && (
            <p id="fullName-error" className="mt-1 text-xs text-[var(--color-danger)]">
              {errors.fullName}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="email"
            className="mb-1 block text-sm font-medium text-[var(--color-foreground)]"
          >
            Email address <span className="text-[var(--color-danger)]">*</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "email-error" : undefined}
            value={form.email}
            onChange={handleChange}
            placeholder="you@example.com"
            className={inputClass}
            disabled={isLoading}
          />
          {errors.email && (
            <p id="email-error" className="mt-1 text-xs text-[var(--color-danger)]">
              {errors.email}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="password"
            className="mb-1 block text-sm font-medium text-[var(--color-foreground)]"
          >
            Password <span className="text-[var(--color-danger)]">*</span>
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "password-error" : undefined}
            value={form.password}
            onChange={handleChange}
            placeholder="Min. 8 characters"
            className={inputClass}
            disabled={isLoading}
          />
          {errors.password && (
            <p id="password-error" className="mt-1 text-xs text-[var(--color-danger)]">
              {errors.password}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="confirmPassword"
            className="mb-1 block text-sm font-medium text-[var(--color-foreground)]"
          >
            Confirm password <span className="text-[var(--color-danger)]">*</span>
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            aria-invalid={!!errors.confirmPassword}
            aria-describedby={
              errors.confirmPassword ? "confirmPassword-error" : undefined
            }
            value={form.confirmPassword}
            onChange={handleChange}
            placeholder="Re-enter your password"
            className={inputClass}
            disabled={isLoading}
          />
          {errors.confirmPassword && (
            <p
              id="confirmPassword-error"
              className="mt-1 text-xs text-[var(--color-danger)]"
            >
              {errors.confirmPassword}
            </p>
          )}
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-[var(--color-foreground)]">
            I am a <span className="text-[var(--color-danger)]">*</span>
          </legend>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
              <input
                type="radio"
                name="role"
                value="student"
                checked={form.role === "student"}
                onChange={() => handleRoleChange("student")}
                disabled={isLoading}
                className="h-4 w-4 border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-focus-ring)]"
              />
              Student
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
              <input
                type="radio"
                name="role"
                value="faculty"
                checked={form.role === "faculty"}
                onChange={() => handleRoleChange("faculty")}
                disabled={isLoading}
                className="h-4 w-4 border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-focus-ring)]"
              />
              Faculty
            </label>
          </div>
        </fieldset>

        {form.role === "student" && (
          <div className="space-y-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4">
            <h3 className="text-sm font-medium text-[var(--color-foreground)]">
              Student Information
            </h3>

            <div>
              <label
                htmlFor="studentNumber"
                className="mb-1 block text-sm font-medium text-[var(--color-foreground)]"
              >
                Student number{" "}
                <span className="text-[var(--color-danger)]">*</span>
              </label>
              <input
                id="studentNumber"
                name="studentNumber"
                type="text"
                autoComplete="off"
                required
                aria-invalid={!!errors.studentNumber}
                aria-describedby={
                  errors.studentNumber ? "studentNumber-error" : undefined
                }
                value={form.studentNumber}
                onChange={handleChange}
                placeholder="e.g. 2024-00001"
                className={inputClass}
                disabled={isLoading}
              />
              {errors.studentNumber && (
                <p
                  id="studentNumber-error"
                  className="mt-1 text-xs text-[var(--color-danger)]"
                >
                  {errors.studentNumber}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="program"
                className="mb-1 block text-sm font-medium text-[var(--color-foreground)]"
              >
                Program <span className="text-[var(--color-danger)]">*</span>
              </label>
              <select
                id="program"
                name="program"
                required
                aria-invalid={!!errors.program}
                aria-describedby={errors.program ? "program-error" : undefined}
                value={form.program}
                onChange={handleChange}
                className={inputClass}
                disabled={isLoading}
              >
                <option value="">Select your program</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              {errors.program && (
                <p id="program-error" className="mt-1 text-xs text-[var(--color-danger)]">
                  {errors.program}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="yearLevel"
                  className="mb-1 block text-sm font-medium text-[var(--color-foreground)]"
                >
                  Year level <span className="text-[var(--color-danger)]">*</span>
                </label>
                <select
                  id="yearLevel"
                  name="yearLevel"
                  required
                  aria-invalid={!!errors.yearLevel}
                  aria-describedby={
                    errors.yearLevel ? "yearLevel-error" : undefined
                  }
                  value={form.yearLevel}
                  onChange={handleChange}
                  className={inputClass}
                  disabled={isLoading}
                >
                  <option value="">Year</option>
                  {yearLevels.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.label}
                    </option>
                  ))}
                </select>
                {errors.yearLevel && (
                  <p
                    id="yearLevel-error"
                    className="mt-1 text-xs text-[var(--color-danger)]"
                  >
                    {errors.yearLevel}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="section"
                  className="mb-1 block text-sm font-medium text-[var(--color-foreground)]"
                >
                  Section <span className="text-[var(--color-danger)]">*</span>
                </label>
                <input
                  id="section"
                  name="section"
                  type="text"
                  required
                  aria-invalid={!!errors.section}
                  aria-describedby={errors.section ? "section-error" : undefined}
                  value={form.section}
                  onChange={handleChange}
                  placeholder="e.g. A"
                  className={inputClass}
                  disabled={isLoading}
                />
                {errors.section && (
                  <p id="section-error" className="mt-1 text-xs text-[var(--color-danger)]">
                    {errors.section}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {form.role === "faculty" && (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4">
            <h3 className="mb-3 text-sm font-medium text-[var(--color-foreground)]">
              Faculty Information
            </h3>
            <div>
              <label
                htmlFor="employeeNumber"
                className="mb-1 block text-sm font-medium text-[var(--color-foreground)]"
              >
                Employee number
              </label>
              <input
                id="employeeNumber"
                name="employeeNumber"
                type="text"
                autoComplete="off"
                aria-invalid={!!errors.employeeNumber}
                aria-describedby={
                  errors.employeeNumber ? "employeeNumber-error" : undefined
                }
                value={form.employeeNumber}
                onChange={handleChange}
                placeholder="e.g. EMP-0001"
                className={inputClass}
                disabled={isLoading}
              />
              {errors.employeeNumber && (
                <p
                  id="employeeNumber-error"
                  className="mt-1 text-xs text-[var(--color-danger)]"
                >
                  {errors.employeeNumber}
                </p>
              )}
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-lg bg-[var(--color-primary)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--color-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? (
            <span className="inline-flex items-center gap-2">
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Creating account...
            </span>
          ) : (
            "Create account"
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-[var(--color-muted)]">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-[var(--color-primary)] hover:text-[var(--color-primary-hover)]"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
