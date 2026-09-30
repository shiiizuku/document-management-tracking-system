import { api } from './api';

export interface Division {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

export interface Section {
  id: string;
  divisionId: string;
  code: string;
  name: string;
  active: boolean;
}

export const fetchDivisions = (): Promise<Division[]> => api<Division[]>('/divisions');

export const fetchSections = (divisionId: string): Promise<Section[]> =>
  api<Section[]>(`/sections?divisionId=${encodeURIComponent(divisionId)}`);
