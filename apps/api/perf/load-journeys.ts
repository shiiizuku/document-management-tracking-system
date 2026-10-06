import { HttpError, type Session } from './load-client.js';

/**
 * The workflow half of the load: the two acceptance-scenario journeys, cut into steps so that many
 * of them interleave the way an office's work does.
 *
 * Each step is one write by the account the scenario names for it — the Records Officer
 * registers, scans, forwards and archives; a member of the receiving division accepts and records
 * compliance; a division head drafts, initials and submits; the Director signs and does nothing
 * else (ADR-0006). A workflow arrival advances one journey by one step, so the write rate is set by
 * the arrival rate rather than by how fast one journey can be pushed through.
 *
 * The journeys are `docs/acceptance-scenarios.md` §1 and §2, without the for-information copy's
 * acknowledgement (added after D2 was measured; it is one route-row stamp, the same write as an
 * acceptance) and without the ORD variant.
 */

export interface DocumentState {
  id: string;
  version: number;
  status: string;
  hasCleanCurrentAttachment?: boolean;
}

export interface Principals {
  records: Session[];
  director: Session;
  /** Division heads by division id, for the outgoing journey's author. */
  heads: Map<string, Session>;
  /** Every non-ORD member of a division, by division id, for the incoming journey's handler. */
  members: Map<string, Session[]>;
}

export interface JourneyContext {
  principals: Principals;
  pdf: (name: string) => Buffer;
  pick: <T>(items: readonly T[]) => T;
  random: () => number;
  ordDivisionId: string;
  recordsSectionId: string;
  /** Counts what is not a failure but is worth reporting: version retries and scan waits. */
  note: (event: 'version-retry' | 'scan-wait') => void;
}

type Step = (journey: Journey, context: JourneyContext) => Promise<void>;

export class Journey {
  document: DocumentState | undefined;
  /** Who holds the document now, for an upload arrival that wants its custodian. */
  custodian: Session | undefined;
  handler: Session | undefined;
  step = 0;
  busy = false;
  /** Not before this time: set while an outgoing draft waits for its scan verdict. */
  notBefore = 0;
  readonly steps: readonly Step[];

  constructor(
    readonly kind: 'incoming' | 'outgoing',
    readonly author: Session,
  ) {
    this.steps = kind === 'incoming' ? INCOMING : OUTGOING;
  }

  get done(): boolean {
    return this.step >= this.steps.length;
  }

  async advance(context: JourneyContext): Promise<void> {
    const step = this.steps[this.step];
    if (step === undefined) return;
    await step(this, context);
    this.step += 1;
  }
}

const documentPath = (journey: Journey): string => `/documents/${journey.document!.id}`;

/**
 * A workflow command under the optimistic-concurrency check. The harness tracks each document's
 * version from the responses it receives, and an extra upload arrival can bump it underneath a
 * journey between two steps, so a stale version is expected occasionally. The remedy is what the UI
 * does — reread, retry once — and the report counts it.
 */
const act = async (
  journey: Journey,
  session: Session,
  action: string,
  context: JourneyContext,
  extra: Record<string, unknown> = {},
): Promise<void> => {
  const send = () =>
    session.post<DocumentState>(
      `POST action ${action}`,
      `${documentPath(journey)}/actions/${action}`,
      {
        expectedVersion: journey.document!.version,
        ...extra,
      },
    );
  try {
    journey.document = await send();
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 409) throw error;
    context.note('version-retry');
    journey.document = await session.get<DocumentState>(
      'GET /documents/:id',
      documentPath(journey),
    );
    journey.document = await send();
  }
};

const uploadScan = async (journey: Journey, session: Session, context: JourneyContext) => {
  await session.upload(
    'POST attachment',
    `${documentPath(journey)}/attachments`,
    `scan-${journey.document!.id.slice(0, 8)}.pdf`,
    context.pdf(journey.document!.id),
  );
  // `setCurrentFileVersion` bumps the row version and the response does not carry it.
  journey.document!.version += 1;
};

const INCOMING: readonly Step[] = [
  // §1.1 Registration confers no custody.
  async (journey, context) => {
    journey.document = await journey.author.post<DocumentState>('POST /documents', '/documents', {
      title: `Load test incoming ${Math.floor(context.random() * 1e9)}`,
      type: 'LETTER',
      priority: 'NORMAL',
      direction: 'INCOMING',
      sender: 'Provincial Assessor, Benguet',
      divisionId: context.ordDivisionId,
      sectionId: context.recordsSectionId,
    });
    journey.custodian = journey.author;
  },
  // §1.2 The holding unit takes it on.
  (journey, context) => act(journey, journey.author, 'ACCEPT', context),
  // §1.3 The scan.
  (journey, context) => uploadScan(journey, journey.author, context),
  // §1.4 One lead, and a for-information copy on a fifth of forwards.
  async (journey, context) => {
    const divisions = [...context.principals.members.keys()];
    const lead = context.pick(divisions);
    const others = divisions.filter((division) => division !== lead);
    journey.handler = context.pick(context.principals.members.get(lead)!);
    journey.document = await journey.author.post<DocumentState>(
      'POST /documents/:id/routes',
      `${documentPath(journey)}/routes`,
      {
        expectedVersion: journey.document!.version,
        toDivisionId: lead,
        ...(context.random() < 0.2 ? { forInformationDivisionIds: [context.pick(others)] } : {}),
        remarks: 'For action. Reply within 7 days.',
      },
    );
    journey.custodian = undefined;
  },
  // §1.5 The lead accepts and records compliance, with remarks (decision 163).
  async (journey, context) => {
    await act(journey, journey.handler!, 'ACCEPT', context);
    journey.custodian = journey.handler;
  },
  async (journey, context) => {
    await act(journey, journey.handler!, 'COMPLY', context, {
      remarks: 'Certified copy issued and released to the requesting office.',
    });
    journey.custodian = undefined;
  },
  // §1.6 Closing the record.
  (journey, context) => act(journey, context.pick(context.principals.records), 'ARCHIVE', context),
];

const OUTGOING: readonly Step[] = [
  // §2.1 Registered at division level by its head, which allocates the office's reference.
  async (journey, context) => {
    journey.document = await journey.author.post<DocumentState>('POST /documents', '/documents', {
      title: `Load test outgoing ${Math.floor(context.random() * 1e9)}`,
      type: 'MEMORANDUM',
      priority: 'NORMAL',
      direction: 'OUTGOING',
      divisionId: journey.author.account.divisionId,
    });
  },
  // §2.2 Taken on, and its file uploaded.
  async (journey, context) => {
    await act(journey, journey.author, 'ACCEPT', context);
    journey.custodian = journey.author;
  },
  (journey, context) => uploadScan(journey, journey.author, context),
  // §2.3 The head's initial, then submission.
  (journey, context) => act(journey, journey.author, 'INITIAL', context),
  async (journey, context) => {
    await act(journey, journey.author, 'SUBMIT_FOR_SIGNATURE', context);
    journey.custodian = undefined;
  },
  /*
   * §2.4 The Director signs — the current attachment, which must be clean. The Director opens the
   * document first, as anyone signing would; if the scan has not reported yet the step is put back
   * and retried later, which is the fail-closed posture working rather than a failure.
   */
  async (journey, context) => {
    const director = context.principals.director;
    journey.document = await director.get<DocumentState>(
      'GET /documents/:id',
      documentPath(journey),
    );
    if (journey.document.hasCleanCurrentAttachment !== true) {
      context.note('scan-wait');
      journey.notBefore = Date.now() + 2_000;
      throw new ScanPending();
    }
    await act(journey, director, 'SIGN', context);
  },
  // §2.5 Release, with a consignment number for a courier, then archive.
  (journey, context) =>
    act(journey, context.pick(context.principals.records), 'PREPARE_RELEASE', context),
  (journey, context) =>
    act(
      journey,
      context.pick(context.principals.records),
      'RELEASE',
      context,
      context.random() < 0.3
        ? {
            releaseMethod: 'MAILED',
            releaseCarrier: 'LBC',
            trackingReference: `LBC-${journey.document!.id.slice(0, 12)}`,
          }
        : { releaseMethod: 'EMAILED' },
    ),
  (journey, context) => act(journey, context.pick(context.principals.records), 'ARCHIVE', context),
];

/** Thrown by a step that is not ready yet; the journey stays on the same step. */
export class ScanPending extends Error {
  constructor() {
    super('The scan verdict has not arrived yet');
  }
}
