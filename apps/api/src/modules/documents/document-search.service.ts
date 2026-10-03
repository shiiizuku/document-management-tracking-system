import type {
  AuthorizationActor,
  AuthorizationPolicy,
  AuthorizationResource,
} from '../authorization/authorization.policy.js';
import type { WorkflowStatus } from '../workflow/workflow.service.js';

export type DocumentPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface SearchableDocument extends AuthorizationResource {
  /*
   * Where the document is now, which is not `divisionId` — that one is the registering placement
   * and never moves (ADR-0005). The division filter below asks the user's question, so it reads
   * these; the inherited `divisionId` / `sectionId` are scope's, and conflating the two would
   * either filter by who filed the document or scope by who currently holds it.
   */
  custodyDivisionId: string;
  custodySectionId: string | null;
  title: string;
  trackingNumber: string;
  referenceNumber: string | null;
  sender: string | null;
  company: string | null;
  description: string | null;
  status: WorkflowStatus;
  priority: DocumentPriority;
  type: string;
  direction: 'INCOMING' | 'OUTGOING';
  createdAt: Date;
}

export interface DocumentSearchQuery {
  search?: string;
  /*
   * A stored status only. `PENDING` is derived from unaccepted route rows (ADR-0005), which this
   * service does not see — filtering on it is the SQL path's job, where the rows live. Typing the
   * field as the stored vocabulary is what stops a caller passing a filter this cannot honour.
   */
  status?: WorkflowStatus;
  priority?: DocumentPriority;
  type?: string;
  direction?: 'INCOMING' | 'OUTGOING';
  divisionId?: string;
  sectionId?: string;
  sort?: 'createdAt' | 'priority' | 'status';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface DocumentSearchResult {
  items: SearchableDocument[];
  total: number;
  page: number;
  pageSize: number;
}

const priorityRank: Record<DocumentPriority, number> = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  URGENT: 3,
};

const statusRank: Record<WorkflowStatus, number> = {
  IN_PROCESS: 0,
  FOR_REVISION: 1,
  FOR_INITIAL: 2,
  FOR_SIGNATURE: 3,
  SIGNED: 4,
  FOR_RELEASE: 5,
  RELEASED: 6,
  COMPLIED: 7,
  ARCHIVED: 8,
};

export class DocumentSearchService {
  constructor(private readonly authorization: AuthorizationPolicy) {}

  execute(
    actor: AuthorizationActor,
    documents: readonly SearchableDocument[],
    query: DocumentSearchQuery,
  ): DocumentSearchResult {
    const normalizedSearch = query.search?.trim().toLocaleLowerCase() ?? '';
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const order = query.order === 'asc' ? 1 : -1;

    const scoped = this.authorization
      .filterReadable(actor, documents)
      .filter((document) => {
        if (normalizedSearch.length > 0) {
          const searchableFields = [
            document.title,
            document.trackingNumber,
            document.referenceNumber,
            document.sender,
            document.company,
          ];
          if (
            !searchableFields.some((field) => field?.toLocaleLowerCase().includes(normalizedSearch))
          ) {
            return false;
          }
        }
        return (
          (query.status === undefined || document.status === query.status) &&
          (query.priority === undefined || document.priority === query.priority) &&
          (query.type === undefined || document.type === query.type) &&
          (query.direction === undefined || document.direction === query.direction) &&
          (query.divisionId === undefined || document.custodyDivisionId === query.divisionId) &&
          (query.sectionId === undefined || document.custodySectionId === query.sectionId)
        );
      })
      .sort((left, right) => {
        let comparison: number;
        if (query.sort === 'priority') {
          comparison = priorityRank[left.priority] - priorityRank[right.priority];
        } else if (query.sort === 'status') {
          comparison = statusRank[left.status] - statusRank[right.status];
        } else {
          comparison = left.createdAt.getTime() - right.createdAt.getTime();
        }
        if (comparison === 0) {
          return left.id.localeCompare(right.id) * order;
        }
        return comparison * order;
      });

    const offset = (page - 1) * pageSize;
    return {
      items: scoped.slice(offset, offset + pageSize),
      total: scoped.length,
      page,
      pageSize,
    };
  }
}
