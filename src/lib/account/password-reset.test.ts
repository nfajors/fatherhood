import { describe, expect, it } from "vitest";
import { resetPasswordEmail } from "./password-reset";

describe("resetPasswordEmail", () => {
  const url = "https://fs.test/api/auth/reset-password/tok?callbackURL=%2Freset-password";

  it("resets a password", () => {
    const email = resetPasswordEmail({ to: "dad@example.com", name: "Marcus Lee", url, hasPassword: true });
    expect(email.subject).toBe("Reset your Fatherhood.School password");
    expect(email.text).toContain("Hi Marcus,");
    expect(email.text).toContain(`Choose a new password: ${url}`);
    expect(email.text).toContain("60 minutes");
    expect(email.html).toContain(url.replace(/&/g, "&amp;"));
  });

  it("sets a first password for someone who signed up with Google", () => {
    const email = resetPasswordEmail({ to: "dad@example.com", name: "Sam", url, hasPassword: false });
    expect(email.subject).toBe("Set a password for Fatherhood.School");
    expect(email.text).toContain("You sign in to your account with Google");
    expect(email.text).toContain("Google sign-in keeps working");
  });

  it("escapes the name", () => {
    const email = resetPasswordEmail({ to: "x@example.com", name: "<b>Eve</b>", url, hasPassword: true });
    expect(email.html).toContain("Hi &lt;b&gt;Eve&lt;/b&gt;,");
    expect(email.html).not.toContain("<b>Eve");
  });
});
