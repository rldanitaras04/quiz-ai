import type { JSX } from 'react';
import { getRegistrationOptions } from './actions';
import RegisterForm, {
  type ProgramOption,
  type YearLevelOption,
} from './RegisterForm';

// Reference data is fetched per request so newly added programs/year levels
// appear without a rebuild, and so builds with stale env never bake in an
// error banner.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Create your account',
};

export default async function RegisterPage(): Promise<JSX.Element> {
  let programs: ProgramOption[] = [];
  let yearLevels: YearLevelOption[] = [];
  let optionsError: string | null = null;

  try {
    const options = await getRegistrationOptions();
    programs = options.programs;
    yearLevels = options.yearLevels;
  } catch {
    optionsError = 'options_unavailable';
  }

  return (
    <RegisterForm
      programs={programs}
      yearLevels={yearLevels}
      optionsError={optionsError}
    />
  );
}
