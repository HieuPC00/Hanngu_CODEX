"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { ACCESS_COOKIE_NAME } from "@/lib/shared-access";

export default function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    document.cookie = `${ACCESS_COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button className="ghost-button" type="button" onClick={signOut}>
      Đăng xuất
    </button>
  );
}
