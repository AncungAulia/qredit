import { toast } from "sonner";
import { TxLink } from "@/components/shared/TxLink";

/** A success toast as the design shows it: the title, one line of explanation and, for a transaction, its link. */
export function notifySuccess(title: string, { text, hash }: { text?: string; hash?: string } = {}) {
  const description =
    text && hash ? (
      <span className="flex flex-col items-start gap-1">
        <span>{text}</span>
        <TxLink hash={hash} />
      </span>
    ) : hash ? (
      <TxLink hash={hash} />
    ) : (
      text
    );
  toast.success(title, { description });
}
