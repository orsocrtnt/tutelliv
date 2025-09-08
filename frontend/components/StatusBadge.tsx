import React from "react";

type StatusBadgeProps = {
  status: "attente" | "livraison" | "livrée" | "urgent";
};

const colors: Record<StatusBadgeProps["status"], string> = {
  attente: "bg-orange-100 text-orange-700",
  livraison: "bg-blue-100 text-blue-700",
  livrée: "bg-green-100 text-green-700",
  urgent: "bg-red-100 text-red-700",
};

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  return (
    <span
      className={`px-3 py-1 text-sm rounded-full font-medium ${colors[status]}`}
    >
      {status}
    </span>
  );
};

export default StatusBadge;
