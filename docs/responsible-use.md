# Responsible use

Use SiteScout only against websites you own or are explicitly authorised to assess.

The bundled runner is passive and intentionally narrow: HTTPS only, exact configured hosts, approved paths, public IP destinations, `GET`/`HEAD` only, and bounded pages, redirects, timeouts and concurrency. Do not extend it with exploitation, password testing, invasive fingerprinting, state-changing requests, denial-of-service behaviour or attempts to bypass access controls without a separate written authorisation and safety review.

An automated observation is evidence for human review, not proof of a vulnerability, customer harm or legal non-compliance. Record limitations, preserve raw evidence, distinguish potential impact from confirmed harm and require a named human decision before changing a canonical finding or publishing work externally.

The optional Strix pilot is import-only. SiteScout does not authorise or run Strix: external security testing requires its own written scope, disposable target where possible, safety controls and accountable owner. Treat every imported candidate as untrusted until independently reviewed, and never copy raw exploit material or secrets into normal findings, tickets or review notes.
