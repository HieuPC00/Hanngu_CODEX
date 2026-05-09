"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import "./login.css";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function signInWithGoogle() {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback`
      }
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-logo">汉</div>
        <h1>Hán Ngữ</h1>
        <p>Đăng nhập để đồng bộ bài học, ảnh và tiến độ giữa các thiết bị.</p>
        <button className="google-button" type="button" onClick={signInWithGoogle} disabled={loading}>
          <span className="google-icon">G</span>
          {loading ? "Đang chuyển..." : "Đăng nhập với Google"}
        </button>
        {error ? <p className="login-error">{error}</p> : null}
      </section>
    </main>
  );
}
