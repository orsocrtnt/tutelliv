import { Suspense } from "react";
import { AuthForm } from "@/features/auth/auth-form";
import { googleRefusalFrom } from "@/lib/auth/google-login";
import { isGoogleLoginEnabled } from "@/services/supabase/auth-providers";

export default async function DriverLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, googleEnabled] = await Promise.all([searchParams, isGoogleLoginEnabled()]);
  return (
    <Suspense>
      <AuthForm mode="login" loginContext="driver" googleEnabled={googleEnabled} googleRefusal={googleRefusalFrom(params)} />
    </Suspense>
  );
}
