"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { ACCESS_COOKIE_NAME, isValidAccessCode, SHARED_ACCESS_CODE } from "@/lib/shared-access";
import "./login.css";

export default function LoginPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (document.cookie.includes(`${ACCESS_COOKIE_NAME}=${SHARED_ACCESS_CODE}`)) router.replace("/");
  }, [router]);

  async function signInWithCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!isValidAccessCode(code.trim())) {
      setError("Mã đăng nhập không đúng.");
      return;
    }

    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${ACCESS_COOKIE_NAME}=${encodeURIComponent(code.trim())}; path=/; max-age=31536000; samesite=lax${secure}`;

    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-logo">汉</div>
        <h1>Hán Ngữ</h1>
        <p>Nhập mã học chung để vào app. Mã này mở cùng một kho dữ liệu đã lưu.</p>
        <form className="email-login-form" onSubmit={signInWithCode}>
          <label htmlFor="access-code">Mã học</label>
          <input
            id="access-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="nhập mã"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            required
          />
          <button className="email-button" type="submit">
            Đăng nhập
          </button>
        </form>
        {error ? <p className="login-error">{error}</p> : null}
      </section>
    </main>
  );
}
