// ============================================================================
// Validation Types
// ============================================================================

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult<T = void> {
  success: boolean;
  errors: ValidationError[];
  data?: T;
}

export type FormErrors<T extends Record<string, unknown>> = {
  [K in keyof T]?: string;
};

// ============================================================================
// Primitive Validators
// ============================================================================

export function validateRequired(
  value: unknown,
  fieldName: string,
): ValidationResult {
  if (value === null || value === undefined || value === '') {
    return {
      success: false,
      errors: [{ field: fieldName, message: `${fieldName} is required` }],
    };
  }
  return { success: true, errors: [] };
}

export function validateEmail(value: string): ValidationResult {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(value)) {
    return {
      success: false,
      errors: [{ field: 'email', message: 'Invalid email address' }],
    };
  }
  return { success: true, errors: [] };
}

export function validateMinLength(
  value: string,
  min: number,
  fieldName: string,
): ValidationResult {
  if (value.length < min) {
    return {
      success: false,
      errors: [
        { field: fieldName, message: `${fieldName} must be at least ${min} characters` },
      ],
    };
  }
  return { success: true, errors: [] };
}

export function validateMaxLength(
  value: string,
  max: number,
  fieldName: string,
): ValidationResult {
  if (value.length > max) {
    return {
      success: false,
      errors: [
        { field: fieldName, message: `${fieldName} must be at most ${max} characters` },
      ],
    };
  }
  return { success: true, errors: [] };
}

export function validateMinValue(
  value: number,
  min: number,
  fieldName: string,
): ValidationResult {
  if (value < min) {
    return {
      success: false,
      errors: [
        { field: fieldName, message: `${fieldName} must be at least ${min}` },
      ],
    };
  }
  return { success: true, errors: [] };
}

export function validateMaxValue(
  value: number,
  max: number,
  fieldName: string,
): ValidationResult {
  if (value > max) {
    return {
      success: false,
      errors: [
        { field: fieldName, message: `${fieldName} must be at most ${max}` },
      ],
    };
  }
  return { success: true, errors: [] };
}

export function validateRange(
  value: number,
  min: number,
  max: number,
  fieldName: string,
): ValidationResult {
  if (value < min || value > max) {
    return {
      success: false,
      errors: [
        { field: fieldName, message: `${fieldName} must be between ${min} and ${max}` },
      ],
    };
  }
  return { success: true, errors: [] };
}

export function validatePattern(
  value: string,
  pattern: RegExp,
  fieldName: string,
  message?: string,
): ValidationResult {
  if (!pattern.test(value)) {
    return {
      success: false,
      errors: [
        {
          field: fieldName,
          message: message || `${fieldName} format is invalid`,
        },
      ],
    };
  }
  return { success: true, errors: [] };
}

export function validateOneOf<T extends string>(
  value: T,
  allowed: readonly T[],
  fieldName: string,
): ValidationResult {
  if (!allowed.includes(value)) {
    return {
      success: false,
      errors: [
        {
          field: fieldName,
          message: `${fieldName} must be one of: ${allowed.join(', ')}`,
        },
      ],
    };
  }
  return { success: true, errors: [] };
}

export function validateUrl(value: string, fieldName: string): ValidationResult {
  try {
    new URL(value);
    return { success: true, errors: [] };
  } catch {
    return {
      success: false,
      errors: [{ field: fieldName, message: `${fieldName} must be a valid URL` }],
    };
  }
}

export function validateUuid(value: string, fieldName: string): ValidationResult {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) {
    return {
      success: false,
      errors: [{ field: fieldName, message: `${fieldName} must be a valid UUID` }],
    };
  }
  return { success: true, errors: [] };
}

// ============================================================================
// Date Validators
// ============================================================================

export function validateDate(value: string, fieldName: string): ValidationResult {
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return {
      success: false,
      errors: [{ field: fieldName, message: `${fieldName} must be a valid date` }],
    };
  }
  return { success: true, errors: [] };
}

export function validateDateAfter(
  value: string,
  after: string,
  fieldName: string,
): ValidationResult {
  const date = new Date(value);
  const afterDate = new Date(after);
  if (date <= afterDate) {
    return {
      success: false,
      errors: [
        {
          field: fieldName,
          message: `${fieldName} must be after ${afterDate.toLocaleDateString()}`,
        },
      ],
    };
  }
  return { success: true, errors: [] };
}

export function validateDateBefore(
  value: string,
  before: string,
  fieldName: string,
): ValidationResult {
  const date = new Date(value);
  const beforeDate = new Date(before);
  if (date >= beforeDate) {
    return {
      success: false,
      errors: [
        {
          field: fieldName,
          message: `${fieldName} must be before ${beforeDate.toLocaleDateString()}`,
        },
      ],
    };
  }
  return { success: true, errors: [] };
}

// ============================================================================
// Composite Validators
// ============================================================================

export function mergeValidationResults(
  ...results: ValidationResult[]
): ValidationResult {
  const allErrors = results.flatMap((r) => r.errors);
  return {
    success: allErrors.length === 0,
    errors: allErrors,
  };
}

export function validateObject<T extends Record<string, unknown>>(
  data: T,
  rules: Record<keyof T, (value: unknown) => ValidationResult>,
): ValidationResult<T> {
  const results = Object.entries(rules).map(([field, validator]) =>
    validator(data[field]),
  );
  const merged = mergeValidationResults(...results);
  return { ...merged, data } as ValidationResult<T>;
}

// ============================================================================
// Domain-Specific Validators
// ============================================================================

export function validateStudentNumber(value: string): ValidationResult {
  return validatePattern(
    value,
    /^[A-Za-z0-9-]+$/,
    'student_number',
    'Student number must contain only letters, numbers, and hyphens',
  );
}

export function validatePassword(value: string): ValidationResult {
  const errors: ValidationError[] = [];
  if (value.length < 8) {
    errors.push({ field: 'password', message: 'Password must be at least 8 characters' });
  }
  if (!/[A-Z]/.test(value)) {
    errors.push({ field: 'password', message: 'Password must contain at least one uppercase letter' });
  }
  if (!/[a-z]/.test(value)) {
    errors.push({ field: 'password', message: 'Password must contain at least one lowercase letter' });
  }
  if (!/[0-9]/.test(value)) {
    errors.push({ field: 'password', message: 'Password must contain at least one number' });
  }
  return { success: errors.length === 0, errors };
}

export function validateAssessmentSchedule(
  opensAt: string,
  closesAt: string,
): ValidationResult {
  const result = validateDateAfter(closesAt, opensAt, 'closes_at');
  if (!result.success) {
    result.errors[0].message = 'Closing time must be after opening time';
  }
  return result;
}

export function validateDurationMinutes(value: number): ValidationResult {
  return validateRange(value, 1, 480, 'duration_minutes');
}

export function validateAttemptLimit(value: number): ValidationResult {
  return validateRange(value, 1, 10, 'attempt_limit');
}

export function validatePoints(value: number): ValidationResult {
  return validateRange(value, 1, 100, 'points');
}

export function validateTotalItems(items: number): ValidationResult {
  return validateMinValue(items, 1, 'total_items');
}

// ============================================================================
// Form Helpers
// ============================================================================

export function getFieldError<T extends Record<string, unknown>>(
  errors: FormErrors<T>,
  field: keyof T,
): string | undefined {
  return errors[field] as string | undefined;
}

export function hasErrors<T extends Record<string, unknown>>(
  errors: FormErrors<T>,
): boolean {
  return Object.keys(errors).length > 0;
}

export function clearFieldError<T extends Record<string, unknown>>(
  errors: FormErrors<T>,
  field: keyof T,
): FormErrors<T> {
  const next = { ...errors };
  delete next[field];
  return next;
}

export function setFieldError<T extends Record<string, unknown>>(
  errors: FormErrors<T>,
  field: keyof T,
  message: string,
): FormErrors<T> {
  return { ...errors, [field]: message };
}
