"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import "./login.css";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hanngu-codex.vercel.app";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const currentParams = new URLSearchParams(window.location.search);
    const code = currentParams.get("code");

    if (code) {
      window.location.replace(`/auth/callback?${currentParams.toString()}`);
      return;
    }

    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) router.replace("/");
    });
  }, [router]);

  async function signInWithEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSent(false);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${appUrl}/auth/callback`
      }
    });

    if (signInError) {
      setError(signInError.message);
    } else {
      setSent(true);
    }

    setLoading(false);
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-logo">汉</div>
        <h1>Hán Ngữ</h1>
        <p>Nhập email, hệ thống sẽ gửi link đăng nhập. Mở link đó là vào app, không cần mật khẩu.</p>
        <form className="email-login-form" onSubmit={signInWithEmail}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="email của bạn"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <button className="email-button" type="submit" disabled={loading}>
            {loading ? "Đang gửi..." : "Gửi link đăng nhập"}
          </button>
        </form>
        {sent ? <p className="login-success">Đã gửi link. Hãy mở email và bấm vào link đăng nhập.</p> : null}
        {error ? <p className="login-error">{error}</p> : null}
      </section>
    </main>
  );
}
