# Help service operations

The service runs on `sop-gpu1` as part of [Tribase](https://github.com/alloy-org/tribase).
The plugin repository contains the client; Tribase owns ingestion, model configuration,
the public gateway, and Ansible deployment.

## Current public-access status

The public gateway is live. DNS resolves normally, `/help/health` returns HTTP 200, and
public HTTPS chat and opaque-origin CORS checks pass. The compiled plugin host and embedded DOM
also pass a four-question public integration check, including a follow-up, calendar troubleshooting, a feature fallback, and a saved feedback vote.
Recorded screenshots return HTTP 200 and have valid image signatures.

A custom WAF skip rule applies only when `http.host eq "amplenote.noteapps.info"`. It skips
remaining custom rules, Super Bot Fight Mode, Browser Integrity Check, and the browser-oriented
security-level check for this API hostname. The existing NoteApps custom rule is unchanged;
managed WAF and DDoS protection remain active, and the zone security level remains `medium`.
The rule is `56ee269d3db849e0b5fbf71cb3e632f9` in ruleset
`fa3eee1bcfac410da2d6c943ad189ca2`. Exact parameters and verification are recorded in
`reports/public-access.json` and Tribase's `ansible/cloudflare-help-resources.json`.

The 5/20-request tests in `reports/gateway-load.json` used a private SSH connection. Public HTTPS
measurements are recorded separately in `reports/public-gateway-load.json`. These use small
repeated question sets with a warm model and prefix cache; they do not measure broad answer accuracy
or sustained throughput. Installation inside Amplenote remains a user acceptance step.

## Resources

- Hostname: `amplenote.noteapps.info`
- Cloudflare zone: `noteapps.info` (`a5a670b46dd277da8225ece71811d38c`)
- DNS record ID: `19a4ed9361e21bd8af66ad390a3d7a4b` (proxied CNAME)
- Tunnel: `tribase-help-sop-gpu1` (`a6b92f43-f18d-4c8d-93ee-637ee514c572`)
- Connector: official cloudflared `2026.11.0`, pinned by image digest in Tribase inventory
- Origin: `http://127.0.0.1:8091`, restricted by ingress to `/help/chat`, `/help/feedback`, and `/help/health`
- Connector project: `tribase-help`; configuration in `/home/deployuser/tribase/cloudflared`

Only the new `amplenote.noteapps.info` DNS record belongs to this deployment. No records or settings
for `amplenote.com` are changed. The existing NoteApps website's records remain unchanged.

## Deploy and inspect

```sh
cd ~/src/tribase/ansible
ansible-playbook deploy.yml
ansible-playbook help-tunnel.yml --tags connector
curl https://amplenote.noteapps.info/help/health
```

The connector runs an outbound-only connection; no inbound listener was added on the GPU host.
The existing private Tribase API still requires its own API key. Model and database ports are not
published through this tunnel. Anonymous public questions share Tribase's 20-request admission limit
and have a per-IP limit of 60 questions per minute.

Tunnel credentials are generated and retained on the server. Ansible reads them with `no_log` and
renders a connector-only credentials file; neither those files nor general Cloudflare credentials
are committed to either repository. The public IDs above are not secrets.

Inspect without displaying credentials:

```sh
ssh sop-gpu1 'sudo docker logs --tail 30 tribase-help-tunnel-1'
ssh sop-gpu1 'curl -fsS http://127.0.0.1:20241/ready'
```

To disable public access, stop the isolated `tribase-help` Compose project and remove only the
`amplenote.noteapps.info` DNS record and its hostname-only browser-challenge exception. The private
Tribase service and indexed data continue running.
To disable the gateway itself, set `tribase_help_chat_enabled: false` and rerun `deploy.yml`.

## Acceptance checks

- `/help` opens a chat prompt, rather than becoming the default notes dashboard.
- A normal help answer links to an Amplenote help page and exposes its supporting quotation.
- A follow-up resolves its subject from the conversation.
- A capability not answered by help can return an Amplenote-only NoteApps assessment and screenshot.
- Unknown or qualified assessments are never presented as confirmed support.
- The client handles 429, network failures, and missing screenshots without losing the question.
- Private paths such as `/coverage`, `/ask`, and `/v1/models` return 404 at the public hostname.

Source coverage is defined by Tribase's inventories, not a guarantee that every unlisted page exists
in the index. Grounding checks and the help-versus-feature relevance gate use a language model;
representative answer review remains useful as the plugin develops.

## Retrieval regression and feedback review

The original calendar-sidebar failure was retrieval/routing: the indexed Task Domains
introduction ranked below a six-section cutoff, and the fallback replaced every help link with
unrelated feature assessments. The gateway now expands queries, ranks article introductions with
`Xenova/ms-marco-MiniLM-L-6-v2` on CPU, includes configuration sections from the strongest articles,
and keeps recommendations separate from the verified synopsis. Score caching is bounded and
contains no cached answer. Feature-existence fallback is excluded for troubleshooting/how-to
questions and independently checks feature-label relevance.

PostgreSQL tables `help_interactions` and `help_feedback` store questions, resolved wording,
retrieval traces, response/evidence snapshots, and one updatable vote plus optional comment.
No account identity, IP, full conversation history, or plaintext feedback token is persisted in
these tables. Source documents remain the authority; comments never enter generation prompts.
A ranking preference requires two affirmative answers to an identical normalized question and
unchanged evidence versions. It cannot delete sources or change factual claims.

Review recent unanswered questions and negative feedback privately on the server:

```sh
ssh sop-gpu1 'sudo docker exec tribase-api-1 python -m scripts.review_help_feedback --limit 50 --negative-only'
```

Omit `--negative-only` to see all recent queries. The review output excludes feedback credentials.
Use this queue for source edits and regression examples; source edits take effect through normal
help refresh. Questions and feedback remain stored until an operator removes them; clearing the
plugin's local chat does not delete server records. The feedback endpoint has its own per-IP rate
limit, accepts no app/corpus selector, and exposes no public query-log reader.
