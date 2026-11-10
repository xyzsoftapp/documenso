import { type TImageFieldMeta as ImageFieldMeta, ZImageFieldMeta } from '@documenso/lib/types/field-meta';
import { Form } from '@documenso/ui/primitives/form/form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Trans } from '@lingui/react/macro';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';

import { EditorGenericLabelField } from './editor-field-generic-field-forms';

const ZImageFieldFormSchema = ZImageFieldMeta.pick({
  label: true,
});

type TImageFieldFormSchema = z.infer<typeof ZImageFieldFormSchema>;

type EditorFieldImageFormProps = {
  value: z.input<typeof ZImageFieldMeta> | undefined;
  onValueChange: (value: ImageFieldMeta) => void;
};

/**
 * An image field's settings: the label the recipient sees, such as "Company stamp".
 */
export const EditorFieldImageForm = ({
  value = {
    type: 'image',
  },
  onValueChange,
}: EditorFieldImageFormProps) => {
  const form = useForm<TImageFieldFormSchema>({
    resolver: zodResolver(ZImageFieldFormSchema),
    mode: 'onChange',
    defaultValues: {
      label: value.label ?? '',
    },
  });

  const { control } = form;

  const formValues = useWatch({
    control,
  });

  // Dupecode/Inefficient: Done because native isValid won't work for our usecase.
  useEffect(() => {
    const validatedFormValues = ZImageFieldFormSchema.safeParse(formValues);

    if (validatedFormValues.success) {
      onValueChange({
        type: 'image',
        required: true,
        ...validatedFormValues.data,
      });
    }
  }, [formValues]);

  return (
    <Form {...form}>
      <form onSubmit={(e) => e.preventDefault()}>
        <fieldset className="flex flex-col gap-2">
          <EditorGenericLabelField formControl={form.control} />

          <p className="text-muted-foreground text-xs">
            <Trans>The recipient chooses or photographs an image, such as their company stamp, to place here.</Trans>
          </p>
        </fieldset>
      </form>
    </Form>
  );
};
