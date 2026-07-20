'use client';

import { NotePrintPage } from '../../../adjustments/note-print';

export default function DebitNotePrint({ params }: { params: { id: string } }) {
  return <NotePrintPage id={params.id} backPath="/debit-notes" />;
}
