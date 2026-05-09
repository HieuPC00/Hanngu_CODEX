import { redirect } from "next/navigation";
import AppFrame from "@/components/AppFrame";
import StudyHome from "@/components/StudyHome";

export default async function HomePage({
  searchParams
}: {
  searchParams?: Promise<{ code?: string; next?: string }>;
}) {
  const params = await searchParams;

  if (params?.code) {
    const next = params.next ? `&next=${encodeURIComponent(params.next)}` : "";
    redirect(`/auth/callback?code=${encodeURIComponent(params.code)}${next}`);
  }

  return (
    <AppFrame>
      <StudyHome />
    </AppFrame>
  );
}
