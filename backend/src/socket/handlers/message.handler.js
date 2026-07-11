import * as messageService from "../../services/message.service.js";
import { toMessageDTO } from "../../utils/serializers.js";
import { SOCKET_EVENTS } from "../../constants/index.js";
import { withAck } from "../helpers.js";
import { socketRateLimiter } from "../rateLimit.js";

const createLimiter = socketRateLimiter();

export function registerMessageHandlers(io, socket) {
  const { id: userId, username } = socket.user;
  const consumeBudget = createLimiter(socket);

  socket.on(
    SOCKET_EVENTS.MESSAGE_SEND,
    withAck(async ({ roomId, text, parentId = null }) => {
      consumeBudget(); // throws once the per-socket window is exhausted

      const message = await messageService.createMessage({
        roomId,
        sender: userId,
        username,
        text,
        parentId,
      });
      const dto = toMessageDTO(message);

      // io (not socket) so the sender's other tabs get it too. The Valkey
      // adapter carries this to members connected to the other servers.
      io.to(roomId).emit(SOCKET_EVENTS.MESSAGE_NEW, dto);
      return { message: dto };
    })
  );

  socket.on(
    SOCKET_EVENTS.MESSAGE_EDIT,
    withAck(async ({ messageId, text }) => {
      consumeBudget();

      const message = await messageService.editMessage({ messageId, userId, text });
      const dto = toMessageDTO(message);

      // The room is taken from the stored message, never from the client: it
      // must not get to name the room its edit is broadcast into.
      io.to(dto.roomId).emit(SOCKET_EVENTS.MESSAGE_UPDATED, dto);
      return { message: dto };
    })
  );

  socket.on(
    SOCKET_EVENTS.MESSAGE_DELETE,
    withAck(async ({ messageId }) => {
      consumeBudget();

      const message = await messageService.deleteMessage({ messageId, userId });
      const dto = toMessageDTO(message);

      io.to(dto.roomId).emit(SOCKET_EVENTS.MESSAGE_DELETED, dto);
      return { message: dto };
    })
  );

  socket.on(
    SOCKET_EVENTS.MESSAGE_REACT,
    withAck(async ({ messageId, emoji }) => {
      consumeBudget();

      const message = await messageService.toggleReaction({ messageId, userId, emoji });
      const dto = toMessageDTO(message);

      // A reaction is just another way the message changed; clients already
      // know how to patch one in place.
      io.to(dto.roomId).emit(SOCKET_EVENTS.MESSAGE_UPDATED, dto);
      return { message: dto };
    })
  );
}
