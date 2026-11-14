# Help service operations

The service runs on `sop-gpu1` as part of [Tribase](https://github.com/alloy-org/tribase).
The plugin repository contains the client; Tribase owns ingestion, model configuration,
the public gateway, and Ansible deployment.

## Current public-access status

The tunnel is healthy and public DNS is configured. The existing NoteApps zone presents a
JavaScript challenge on this new hostname, so browser API requests currently receive HTTP 403.
Public plugin access is **pending** an additional Cloudflare authorization for a hostname-only
configuration-rule exception. No existing website security setting has been changed. See
`reports/public-access.json` and Tribase's `ansible/cloudflare-help-resources.json` for the exact
resources and proposed rule. The zone-wide challenge source must be confirmed before applying it.

The compiled host and embed passed live-origin tests over a temporary SSH connection. The
5/20-request load tests in `reports/gateway-load.json` used that private test connection, not
public Cloudflare traffic. A recorded NoteApps screenshot returned HTTP 200 with image/png.

## Resources

- Hostname: `amplenote.noteapps.info`
- Cloudflare zone: `noteapps.info` (`a5a670b46dd277da8225ece71811d38c`)
- DNS record ID: `19a4ed9361e21bd8af66ad390a3d7a4b` (proxied CNAME)
- Tunnel: `tribase-help-sop-gpu1` (`a6b92f43-f18d-4c8d-93ee-637ee514c572`)
- Connector: official cloudflared `2026.11.0`, pinned by image digest in Tribase inventory
- Origin: `http://127.0.0.1:8091`, restricted by ingress to `/help/chat` and `/help/health`
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
`amplenote.noteapps.info` DNS record. The private Tribase service and indexed data continue running.
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
