'use client';

import { NotePrintPage } from '../../../adjustments/note-print';

export default function CreditNotePrint({ params }: { params: { id: string } }) {
  return <NotePrintPage id={params.id} backPath="/credit-notes" />;
}
