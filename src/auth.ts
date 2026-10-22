import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "@/auth.config";
import { burnPasswordComparison, passwordTag, verifyPassword } from "@/lib/auth/password";
import { clientKindFromUserAgent } from "@/modules/identity/domain";
import { findOwnerByEmail, normaliseEmail } from "@/modules/identity/repository";
import { createSession } from "@/modules/identity/sessions";

/**
 * Server-side Auth.js instance.
 *
 * A single owner signs in with an email and a password. There is no public
 * sign-up: accounts are created by `npm run db:seed`.
 */
const credentialsSchema = z.object({
  email: z.string().min(3),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Adresse e-mail", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },
      /**
       * Returns `null` for every failure: the caller must not learn whether the
       * address exists, only that the pair is wrong.
       */
      async authorize(rawCredentials, request) {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) {
          return null;
        }

        const owner = await findOwnerByEmail(normaliseEmail(parsed.data.email));

        if (!owner) {
          await burnPasswordComparison(parsed.data.password);
          return null;
        }

        const isPasswordValid = await verifyPassword(
          parsed.data.password,
          owner.passwordHash,
        );
        if (!isPasswordValid) {
          return null;
        }

        // Created only after the password is verified. The row is what the owner can
        // revoke later; the token carries its identifier, and the guard refuses a
        // token whose row is missing, revoked or owned by someone else. The client
        // family comes from this request and the header itself is not kept.
        const sessionId = await createSession(
          owner.id,
          clientKindFromUserAgent(request?.headers.get("user-agent")),
        );

        return {
          id: owner.id,
          email: owner.email,
          name: owner.name ?? undefined,
          // Fingerprint of the hash this session is issued for, so a later password
          // change can sign it out (see `getSessionUser`).
          passwordTag: passwordTag(owner.passwordHash),
          sessionId,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Only the identifier travels in the token; no password hash, no token, no budget data.
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        // A digest, not the hash: enough to detect a change, useless to an attacker.
        token.passwordTag = user.passwordTag;
        // Server-issued identifier of the persisted row. It is never chosen by the
        // browser, so it cannot be fixated.
        token.sessionId = user.sessionId;
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub;
      }
      session.passwordTag = token.passwordTag;
      session.sessionId = token.sessionId;
      return session;
    },
  },
});
