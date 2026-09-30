'use client';

import type { FormEvent } from 'react';
import {
  DEFAULT_FILTERS,
  DOCUMENT_DIRECTIONS,
  DOCUMENT_PRIORITIES,
  DOCUMENT_SORTS,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  type DocumentFilters,
} from '../lib/documents';

interface RegistryControlsProps {
  filters: DocumentFilters;
  onChange: (patch: Partial<DocumentFilters>) => void;
  onSearchSubmit: () => void;
  onClear: () => void;
}

const humanize = (value: string): string =>
  value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ');

const sortLabels: Record<(typeof DOCUMENT_SORTS)[number], string> = {
  createdAt: 'Registered',
  priority: 'Priority',
  status: 'Status',
};

const isDefault = (filters: DocumentFilters): boolean =>
  filters.status === '' &&
  filters.priority === '' &&
  filters.type === '' &&
  filters.direction === '' &&
  filters.search === '' &&
  filters.sort === DEFAULT_FILTERS.sort &&
  filters.order === DEFAULT_FILTERS.order;

export function RegistryControls({
  filters,
  onChange,
  onSearchSubmit,
  onClear,
}: RegistryControlsProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearchSubmit();
  };

  return (
    <form className="registry-controls" onSubmit={submit} aria-label="Document filters">
      <input
        aria-label="Search documents"
        placeholder="Search title, number, sender…"
        value={filters.search}
        onChange={(event) => onChange({ search: event.target.value })}
      />
      <label className="control">
        <span>Status</span>
        <select
          value={filters.status}
          onChange={(event) => onChange({ status: event.target.value })}
        >
          <option value="">All</option>
          {DOCUMENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {humanize(status)}
            </option>
          ))}
        </select>
      </label>
      <label className="control">
        <span>Priority</span>
        <select
          value={filters.priority}
          onChange={(event) => onChange({ priority: event.target.value })}
        >
          <option value="">All</option>
          {DOCUMENT_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {humanize(priority)}
            </option>
          ))}
        </select>
      </label>
      <label className="control">
        <span>Type</span>
        <select value={filters.type} onChange={(event) => onChange({ type: event.target.value })}>
          <option value="">All</option>
          {DOCUMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {humanize(type)}
            </option>
          ))}
        </select>
      </label>
      <label className="control">
        <span>Direction</span>
        <select
          value={filters.direction}
          onChange={(event) => onChange({ direction: event.target.value })}
        >
          <option value="">All</option>
          {DOCUMENT_DIRECTIONS.map((direction) => (
            <option key={direction} value={direction}>
              {humanize(direction)}
            </option>
          ))}
        </select>
      </label>
      <label className="control">
        <span>Sort</span>
        <select
          value={filters.sort}
          onChange={(event) => onChange({ sort: event.target.value as DocumentFilters['sort'] })}
        >
          {DOCUMENT_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {sortLabels[sort]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="control-order"
        aria-label={`Sort ${filters.order === 'asc' ? 'ascending' : 'descending'}`}
        onClick={() => onChange({ order: filters.order === 'asc' ? 'desc' : 'asc' })}
      >
        {filters.order === 'asc' ? '↑' : '↓'}
      </button>
      <button type="submit" className="secondary">
        Search
      </button>
      {!isDefault(filters) && (
        <button type="button" className="control-clear" onClick={onClear}>
          Clear
        </button>
      )}
    </form>
  );
}
