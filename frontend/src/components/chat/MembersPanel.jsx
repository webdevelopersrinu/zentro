import { memo } from "react";
import { Check, Crown, Shield, ShieldOff, UserPlus, X } from "lucide-react";

import { Avatar } from "../ui/Avatar.jsx";
import { Badge } from "../ui/Badge.jsx";
import { Button } from "../ui/Button.jsx";
import { IconButton } from "../ui/IconButton.jsx";
import { PresenceDot } from "../ui/PresenceDot.jsx";
import { SkeletonList } from "../ui/Skeleton.jsx";
import {
  useMembers,
  useRequests,
  useApproveRequest,
  useRejectRequest,
  usePromoteAdmin,
  useDemoteAdmin,
} from "../../hooks/useMembers.js";
import { useAuth } from "../../context/AuthContext.jsx";
import styles from "./MembersPanel.module.css";

/**
 * `canManage` is the creator's, not an admin's: an admin who could promote
 * another would let a room's moderation escape the person who owns it. The
 * creator's own row offers nothing — they cannot be demoted.
 */
const MemberRow = memo(function MemberRow({ member, isYou, canManage, onPromote, onDemote }) {
  return (
    <li className={styles.row}>
      <Avatar src={member.avatarUrl} name={member.name} size={30} />
      <span className={styles.name}>
        {member.name}
        {isYou && <span className={styles.you}>(you)</span>}
      </span>

      {member.isCreator ? (
        <Crown size={13} className={styles.crown} aria-label="Creator" />
      ) : (
        member.isAdmin && <Shield size={13} className={styles.shield} aria-label="Admin" />
      )}

      {canManage &&
        !member.isCreator &&
        (member.isAdmin ? (
          <IconButton label={`Remove ${member.name} as admin`} size="sm" onClick={onDemote}>
            <ShieldOff size={15} />
          </IconButton>
        ) : (
          <IconButton label={`Make ${member.name} an admin`} size="sm" onClick={onPromote}>
            <Shield size={15} />
          </IconButton>
        ))}

      <PresenceDot online={member.online} />
    </li>
  );
});

function RequestRow({ request, onApprove, onReject }) {
  return (
    <li className={styles.row}>
      <Avatar src={request.avatarUrl} name={request.name} size={30} />
      <span className={styles.name}>{request.name}</span>
      <IconButton label={`Approve ${request.name}`} size="sm" variant="success" onClick={onApprove}>
        <Check size={16} />
      </IconButton>
      <IconButton label={`Reject ${request.name}`} size="sm" variant="danger" onClick={onReject}>
        <X size={16} />
      </IconButton>
    </li>
  );
}

export function MembersPanel({ room, onInvite }) {
  const { user } = useAuth();
  const { data: members = [], isLoading } = useMembers(room.id);
  const { data: requests = [] } = useRequests(room.id, { enabled: room.isAdmin });

  const approve = useApproveRequest(room.id);
  const reject = useRejectRequest(room.id);
  const promote = usePromoteAdmin(room.id);
  const demote = useDemoteAdmin(room.id);

  return (
    <aside className={styles.panel} aria-label="Members">
      <section className={styles.section}>
        <h2 className={styles.heading}>
          Members <Badge>{members.length}</Badge>
        </h2>
        {isLoading ? (
          <SkeletonList count={4} />
        ) : (
          <ul className={styles.list}>
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                isYou={member.id === user.id}
                canManage={room.isCreator}
                onPromote={() => promote.mutate(member.id)}
                onDemote={() => demote.mutate(member.id)}
              />
            ))}
          </ul>
        )}
      </section>

      {room.isAdmin && requests.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.heading}>
            Requests <Badge tone="warning">{requests.length}</Badge>
          </h2>
          <ul className={styles.list}>
            {requests.map((request) => (
              <RequestRow
                key={request.id}
                request={request}
                onApprove={() => approve.mutate(request.id)}
                onReject={() => reject.mutate(request.id)}
              />
            ))}
          </ul>
        </section>
      )}

      {room.isAdmin && (
        <div className={styles.invite}>
          <Button variant="secondary" fullWidth startIcon={<UserPlus size={16} />} onClick={onInvite}>
            Invite people
          </Button>
        </div>
      )}
    </aside>
  );
}
