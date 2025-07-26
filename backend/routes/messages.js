const express = require("express");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const router = express.Router();

// 에러 핸들링을 위한 유틸리티
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// 인증 미들웨어ㅇ
const isAuthenticated = (req, res, next) => {
  const userId = req.headers["x-user-id"];
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized: User ID is required" });
  }
  req.userId = userId;
  next();
};

// POST /api/messages/:messageId/reactions - 특정 메시지에 반응 추가
router.post(
  "/:messageId/reactions",
  isAuthenticated,
  asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const userId = req.userId;

    if (!emoji) {
      return res.status(400).json({ error: "Emoji is required" });
    }

    // 이미 존재하는 반응인지 확인 (upsert를 사용하여 간결하게 처리)
    const reaction = await prisma.reaction.upsert({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId,
          emoji,
        },
      },
      update: {}, // 이미 존재하면 아무것도 변경하지 않음
      create: {
        messageId,
        userId,
        emoji,
      },
    });

    res.status(201).json(reaction);
  })
);

// DELETE /api/messages/:messageId/reactions/:emoji - 특정 메시지 반응 삭제
router.delete(
  "/:messageId/reactions/:emoji",
  isAuthenticated,
  asyncHandler(async (req, res) => {
    const { messageId, emoji: encodedEmoji } = req.params;
    const emoji = decodeURIComponent(encodedEmoji);
    const userId = req.userId;

    // --- DEBUG LOGGING START ---
    console.log('--- Deleting Reaction ---');
    console.log('Received Message ID:', messageId);
    console.log('Received User ID:', userId);
    console.log('Encoded Emoji:', encodedEmoji);
    console.log('Decoded Emoji:', emoji);
    // --- DEBUG LOGGING END ---

    if (!emoji) {
      return res.status(400).json({ error: "Emoji is required for deletion" });
    }

    try {
      await prisma.reaction.delete({
        where: {
          messageId_userId_emoji: {
            messageId,
            userId,
            emoji,
          },
        },
      });
      console.log('--- Deletion Successful ---');
      res.status(204).send();
    } catch (error) {
      console.log('--- Deletion FAILED ---');
      console.error('Prisma Error Code:', error.code);
      console.error('Error Details:', error);
      // 삭제하려는 데이터가 없을 때 Prisma는 에러를 발생시킴 (P2025)
      if (error.code === "P2025") {
        return res.status(404).json({ error: "Reaction not found" });
      }
      // 그 외 다른 에러
      res.status(500).json({ error: "Could not delete reaction" });
    }
  })
);

module.exports = router;
