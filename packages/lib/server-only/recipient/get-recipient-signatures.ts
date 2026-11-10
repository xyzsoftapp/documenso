import { prisma } from '@documenso/prisma';
import { FieldType } from '@prisma/client';

export type GetRecipientSignaturesOptions = {
  recipientId: number;
};

export const getRecipientSignatures = async ({ recipientId }: GetRecipientSignaturesOptions) => {
  return await prisma.signature.findMany({
    where: {
      field: {
        recipientId,
        // An image field, such as a stamp, keeps its image here too, but it is not the recipient's signature
        type: {
          not: FieldType.IMAGE,
        },
      },
    },
  });
};
