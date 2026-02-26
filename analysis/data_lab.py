import pandas as pd
import matplotlib.pyplot as plt
import os

def analyse_motion(csv_file):
    # Load the data from your saved CSV
    # The columns should match your JS save logic: timestamp, x_uT, y_uT, z_uT
    df = pd.read_csv(csv_file)
    
    # Convert timestamp to seconds starting from 0
    df['seconds'] = (df['timestamp'] - df['timestamp'].iloc[0]) / 1000.0

    plt.figure(figsize=(12, 6))
    
    # Plotting the three axes in µT
    plt.plot(df['seconds'], df['x_uT'], label='X-Axis', color='#ff6384')
    plt.plot(df['seconds'], df['y_uT'], label='Y-Axis', color='#36a2eb')
    plt.plot(df['seconds'], df['z_uT'], label='Z-Axis', color='#4caf50')

    plt.title(f"Motion Analysis: {os.path.basename(csv_file)}")
    plt.xlabel("Time (seconds)")
    plt.ylabel("Magnetic Flux Density (µT)")
    plt.legend()
    plt.grid(True, alpha=0.3)
    
    # Simple Quality Metric: Peak-to-Peak Amplitude
    range_x = df['x_uT'].max() - df['x_uT'].min()
    print(f"File: {csv_file}")
    print(f"X-Axis Range: {range_x:.2f} µT")
    
    output_dir = "../plots"
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, f"{os.path.splitext(os.path.basename(csv_file))[0]}.png")
    plt.savefig(output_path, dpi=300, bbox_inches="tight")
    
    plt.show() 