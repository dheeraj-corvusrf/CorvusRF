import { supabase } from "./supabase";
import type { SignatureValue } from "@/components/SignaturePad";

export type AuthorizationInput = {
  protestId?: string;
  propertyId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  isEntity: boolean;
  entityName?: string;
  entityRelationship?: string;
  entityType?: string;
  purchasedRecently: boolean;
  signature: SignatureValue;
};

export async function createAuthorization(userId: string, input: AuthorizationInput): Promise<void> {
  const { error } = await supabase.from("protest_authorizations").insert({
    protest_id: input.protestId ?? null,
    property_id: input.propertyId,
    user_id: userId,
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    phone: input.phone,
    is_entity: input.isEntity,
    entity_name: input.isEntity ? (input.entityName ?? null) : null,
    entity_relationship: input.isEntity ? (input.entityRelationship ?? null) : null,
    entity_type: input.isEntity ? (input.entityType ?? null) : null,
    purchased_recently: input.purchasedRecently,
    signature_type: input.signature.type,
    signature_data: input.signature.data,
  });
  if (error) throw error;
}
