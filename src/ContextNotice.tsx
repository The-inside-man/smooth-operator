import { Info } from 'lucide-react';
import type { ContextUsage } from './types';
import './context-notice.css';

export default function ContextNotice({ usage }: { usage?: ContextUsage }) {
  if (!usage?.removedMessages) return null;
  return <div className="context-notice" role="status"><Info size={13}/><span>Earlier conversation messages were left out to fit this model. Your latest request was kept in full.</span></div>;
}
