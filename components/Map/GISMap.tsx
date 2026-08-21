"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { mapLocations } from "@/lib/data";
import "leaflet/dist/leaflet.css";

// Fix for default marker icons in Leaflet
const createCustomIcon = (color: string) => {
  return L.divIcon({
    className: "custom-marker",
    html: `
      <div style="position: relative; width: 40px; height: 40px;">
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 40px;
          height: 40px;
          background: ${color}33;
          border-radius: 50%;
          animation: pulse 2s infinite;
        "></div>
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 16px;
          height: 16px;
          background: ${color};
          border-radius: 50%;
          box-shadow: 0 0 0 4px ${color}4D;
        "></div>
      </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -20],
  });
};

const markerColors: Record<string, string> = {
  bimbel: "#1E88E5",
  roadshow: "#F9A825",
};

// Map bounds fitter component
function MapBoundsFitter() {
  const map = useMap();

  useEffect(() => {
    const bounds = L.latLngBounds(
      mapLocations.map((loc) => [loc.lat, loc.lng])
    );
    map.fitBounds(bounds, { padding: [50, 50] });
  }, [map]);

  return null;
}

export default function GISMap() {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return (
      <div className="w-full h-[500px] bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl flex items-center justify-center">
        <span className="text-gray-500">Loading map...</span>
      </div>
    );
  }

  return (
    <div className="relative rounded-2xl overflow-hidden shadow-lg">
      <MapContainer
        center={[-6.9175, 107.6191]}
        zoom={9}
        scrollWheelZoom={false}
        className="w-full h-[500px] z-0"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapBoundsFitter />

        {mapLocations.map((location) => (
          <Marker
            key={location.id}
            position={[location.lat, location.lng]}
            icon={createCustomIcon(markerColors[location.type])}
          >
            <Popup>
              <div className="text-center p-2">
                <h4 className="font-bold text-gray-900">{location.name}</h4>
                <p className="text-sm text-gray-500">{location.region}</p>
                <span className={`inline-block mt-2 text-xs px-2 py-1 rounded-full ${
                  location.type === "bimbel"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-yellow-100 text-yellow-700"
                }`}>
                  {location.type === "bimbel" ? "Bimbel Aktif" : "Roadshow"}
                </span>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {/* Legend */}
      <div className="absolute bottom-6 left-6 bg-white p-4 rounded-xl shadow-lg z-[1000]">
        <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-3">
          Legenda
        </h4>
        <div className="space-y-2">
          <div className="flex items-center gap-2.5 text-[13px] text-gray-700">
            <div className="w-3 h-3 rounded-full bg-primary-blue" />
            <span>Bimbel Aktif</span>
          </div>
        </div>
      </div>

      {/* Inject pulse animation styles */}
      <style jsx global>{`
        @keyframes pulse {
          0% {
            transform: translate(-50%, -50%) scale(0.5);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) scale(1.5);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
