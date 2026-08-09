'use client';

/**
 * Uploaded files for a customer or vendor (AP_ARCHITECTURE_DECISION §7).
 *
 * Sits beside the existing link-based "Documents" list rather than replacing
 * it — those rows are real data pointing at Google Drive and elsewhere, and
 * silently dropping them to make room for this would lose references nobody
 * asked to lose. The two answer different questions: a link says where a file
 * lives, this says the file is here.
 *
 * Upload needs an id, so the panel only appears once the record exists.
 */

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Paperclip, Trash2, Upload } from 'lucide-react';
import { ErrorText } from '@/components/ui';
import { api, downloadFile, hasPermission, uploadFile } from '@/lib/api';

export type AttachmentOwner = 'customers' | 'vendors';

interface Attachment {
  id: string; originalName: string; mimeType: string; sizeBytes: number;
  category: string | null; notes: string | null; uploadedAt: string;
  uploadedBy: { fullName: string } | null;
}

const CATEGORIES = [
  'Business Registration', 'Tax Certificate', 'Credit Application',
  'Signed Agreement', 'Insurance', 'Licence', 'Other',
];

const fmtSize = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

export function AttachmentsPanel({ owner, ownerId }: { owner: AttachmentOwner; ownerId: string | null }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState('');
  const canWrite = hasPermission(owner === 'customers' ? 'customers.write' : 'vendors.write');
  const key = ['attachments', owner, ownerId];

  const { data: rows } = useQuery({
    queryKey: key,
    queryFn: () => api<Attachment[]>(`/${owner}/${ownerId}/attachments`),
    enabled: !!ownerId,
  });

  const upload = useMutation({
    mutationFn: (file: File) =>
      uploadFile(`/${owner}/${ownerId}/attachments`, file, category ? { category } : {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      if (fileRef.current) fileRef.current.value = '';
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/${owner}/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  if (!ownerId) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-4 text-sm text-gray-500">
        <Paperclip size={15} className="inline mr-1" />
        Save this record first — files attach to it once it exists.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Paperclip size={15} className="text-gray-500" />
        <span className="text-sm font-semibold">Uploaded Files</span>
        <span className="text-xs text-gray-400">PDF, images, Word or Excel · max 15 MB</span>
      </div>

      {rows?.length === 0 && <p className="text-sm text-gray-400">No files uploaded yet.</p>}

      <div className="space-y-1">
        {rows?.map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-sm border-b border-gray-100 dark:border-gray-800 pb-1">
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{a.originalName}</div>
              <div className="text-xs text-gray-400">
                {a.category ? `${a.category} · ` : ''}{fmtSize(a.sizeBytes)} ·{' '}
                {new Date(a.uploadedAt).toISOString().slice(0, 10)}
                {a.uploadedBy ? ` · ${a.uploadedBy.fullName}` : ''}
              </div>
            </div>
            <button type="button" title="Download"
              className="text-primary hover:underline shrink-0"
              onClick={() => downloadFile(`/${owner}/attachments/${a.id}/download`, a.originalName)}>
              <Download size={15} />
            </button>
            {canWrite && (
              <button type="button" title="Delete"
                className="text-red-500 hover:underline shrink-0 disabled:opacity-50"
                disabled={remove.isPending}
                onClick={() => { if (confirm(`Delete ${a.originalName}? This removes the file itself.`)) remove.mutate(a.id); }}>
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
      </div>

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <select className="input max-w-[200px]" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Category (optional)</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <input ref={fileRef} type="file" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); }} />
          {/* type="button": this panel lives inside the master form, and a bare
              button would submit it instead of opening the file picker. */}
          <button type="button" className="btn-ghost" disabled={upload.isPending}
            onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> {upload.isPending ? 'Uploading…' : 'Upload File'}
          </button>
        </div>
      )}

      <ErrorText error={upload.error} />
      <ErrorText error={remove.error} />
    </div>
  );
}
