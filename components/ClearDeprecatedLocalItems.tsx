"use client";

import { useEffect } from "react";

export default function ClearDeprecatedLocalItems() {
  useEffect(() => {
    localStorage.removeItem("hanngu-local-items");
  }, []);

  return null;
}
