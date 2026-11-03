import { Icon } from "@payl/ui";

export type Offer = {
  offerId: string; merchantId: string; merchantName: string; name: string; description: string;
  priceMinor: string; currency: string; fulfillmentMethod: "digital_download" | "digital_service";
  refundable: boolean; refundWindowMinutes: number | null;
};

export default function ChatOfferCard({ offer, onReview, disabled }: { offer: Offer; onReview: (offer: Offer) => void; disabled: boolean }) {
  const price = new Intl.NumberFormat("en-US", { style: "currency", currency: offer.currency }).format(Number(offer.priceMinor) / 100);
  const minutes = offer.refundWindowMinutes;
  const refunds = !offer.refundable || !minutes ? "Non-refundable" : minutes % 1440 === 0 ? `${minutes / 1440}-day refund window` : `${minutes / 60}-hour refund window`;
  return <article className="chat-offer-card">
    <div className="chat-offer-source"><span className="chat-offer-icon"><Icon name={offer.fulfillmentMethod === "digital_download" ? "download" : "box"} size={18} /></span><span>{offer.merchantName}</span></div>
    <div className="chat-offer-heading"><h3>{offer.name}</h3><div className="chat-offer-price"><strong>{price}</strong><small>{offer.currency}</small></div></div>
    <p className="chat-offer-description">{offer.description}</p>
    <div className="chat-offer-tags"><span>{offer.fulfillmentMethod === "digital_download" ? "Digital download" : "Digital service"}</span><span><Icon name="shield" size={13} />{refunds}</span></div>
    <div className="chat-offer-footer"><button type="button" className="secondary-button" disabled={disabled} onClick={() => onReview(offer)}>Review offer<Icon name="arrow" size={15} /></button></div>
  </article>;
}
