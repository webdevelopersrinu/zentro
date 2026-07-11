import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { loadRoom } from "../middleware/loadRoom.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import * as controller from "../controllers/room.controller.js";
import {
  createRoomSchema,
  updateRoomSchema,
  inviteSchema,
  messageQuerySchema,
  searchQuerySchema,
} from "../validators/room.validators.js";

const router = Router();

router.use(requireAuth);

// Collection. "/discover" must precede "/:id/*" so it isn't parsed as an id.
router.post("/", validateBody(createRoomSchema), controller.create);
router.get("/", controller.listMine);
router.get("/discover", controller.discover);

// Everything below operates on one room; loadRoom puts it on req.room.
router.use("/:id", loadRoom);

router.get("/:id/messages", validateQuery(messageQuerySchema), controller.listMessages);
router.get("/:id/messages/search", validateQuery(searchQuerySchema), controller.searchMessages);
router.get("/:id/messages/:messageId/replies", controller.listReplies);
router.post("/:id/read", controller.markRead);
router.get("/:id/receipts", controller.listReceipts);
router.get("/:id/members", controller.listMembers);
router.post("/:id/join", controller.join); // also accepts a pending invite
router.post("/:id/leave", controller.leave);
router.post("/:id/invite", validateBody(inviteSchema), controller.invite);
router.post("/:id/invite/decline", controller.declineInvite);

// Creator only: moderation powers are the owner's to grant and revoke.
router.post("/:id/admins/:userId", controller.promoteAdmin);
router.delete("/:id/admins/:userId", controller.demoteAdmin);

router.get("/:id/requests", controller.listRequests);
router.post("/:id/requests/:userId/approve", controller.approveRequest);
router.post("/:id/requests/:userId/reject", controller.rejectRequest);

router.patch("/:id", validateBody(updateRoomSchema), controller.update);
router.delete("/:id", controller.remove);

export default router;
