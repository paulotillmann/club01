/**
 * Formata um número de telefone brasileiro para exibição em formulário ((DD) 9XXXX-XXXX ou (DD) XXXX-XXXX).
 * Remove o código de país DDI 55 quando presente em números com 12 ou 13 dígitos vindos do banco.
 */
export function formatPhoneNumber(value) {
  if (!value) return value
  let digits = String(value).replace(/\D/g, "")
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2)
  }
  const len = digits.length
  if (len < 3) return digits
  if (len < 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (len < 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`
}

