<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Mount trading notifications and the identity-transition cache listener once in the root shell so all pages share consistent feedback and session refresh.
- Keep public navigation session-aware and route registration mode through validated auth search parameters so account buttons open the intended form.
- Account pages share a browser-safe account hook outside route modules to avoid route code-splitting dependencies.
- Demo balance and position mutations use a service-role-only atomic RPC after authenticated owner-scoped reads; expected balances and open-position IDs reject stale concurrent actions.
