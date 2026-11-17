# Safety Incidents pilot

- All signed-in GeoFields roles can report. They can see the type, date, and
  status of their own reports, not the investigation. An assignee sees only
  their own action and can mark it done.
- Office staff can see case references, reporting dates and follow-up status,
  assign actions, and track overdue work. They cannot see the source report,
  injury classification, evidence, findings, or verification notes. A reviewer
  can explicitly share a non-sensitive coordination note with Office.
- Active Admins and Managers can turn **Safety reviewer** on or off in
  **Employees → Create or Edit Employee**, for active Managers or Admins.
  Nobody is automatically a reviewer. The Employee Directory shows who is
  assigned, including to Office readers. Grant and revoke changes are audited.
  A demotion or deactivation removes the assignment; reactivation does not
  restore it. Reviewers and Office coordinators can see their respective queues across workspaces;
  do not configure this as a substitute for site-specific access controls.
- Review actual outcome separately from high potential. Require findings for
  high-potential, lost-time, and fatal cases. A reviewer must verify every
  action before closeout. A low-potential no-injury case with no actions still
  needs a documented closeout reason. High-potential or injury cases need a
  verified action.
- Offline Drilling can save a basic incident after field setup. Reports are
  stored for the signed-in account on that browser and are explicitly sent
  after reconnecting. Do not clear site data before sending, use a shared
  device/profile, or put names or medical details in the offline form.
- Recording, saving locally, or sending an incident here does not notify
  emergency services, site responders, or regulators. The site emergency and
  external reporting processes remain separate.

Before production: apply the additive safety migration through the approved
deployment process, confirm designated reviewers, access scope, and retention
with the site owner, and rehearse submission and closeout on isolated HTTPS QA.
Medical attachments and witness records are not collected in this first version.
