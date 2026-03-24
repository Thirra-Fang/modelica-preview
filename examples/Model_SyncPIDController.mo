model Model_SyncPIDController
parameter Real k = 0.001 "比例常数";
parameter Modelica.Units.SI.Time Ti = 1 "积分时间";
parameter Modelica.Units.SI.Time Td = 1 "微分时间";


  annotation(__MWORKS(version="2025a"),Icon(coordinateSystem(extent={{-100,-100},{100,100}},
grid={2,2}),graphics = {Rectangle(origin={0,0},
lineColor={0,0,127},
fillColor={255,255,255},
fillPattern=FillPattern.Solid,
extent={{-100,-100},{100,100}}), Line(origin={0,0},
points={{-80,78},{-80,-90}},
color={192,192,192}), Polygon(origin={0,0},
lineColor={192,192,192},
fillColor={192,192,192},
fillPattern=FillPattern.Solid,
points={{-80,90},{-88,68},{-72,68},{-80,90}}), Line(origin={0,0},
points={{-90,-80},{82,-80}},
color={192,192,192}), Polygon(origin={0,0},
lineColor={192,192,192},
fillColor={192,192,192},
fillPattern=FillPattern.Solid,
points={{90,-80},{68,-72},{68,-88},{90,-80}}), Line(origin={0,0},
points={{-80,-80},{-80,-20},{30,60},{80,60}},
color={0,0,127}), Text(origin={30,-40},
lineColor={192,192,192},
extent={{-50,20},{50,-20}},
textString="%controllerType",
textColor={192,192,192}), Line(visible=strict,
origin={0,0},
points={{30,60},{81,60}},
color={255,0,0})}));
  Modelica.Blocks.Continuous.LimPID PID(yMin=0,withFeedForward=false,k=k,Ti=Ti,Td=Td,yMax=1) 
    annotation (Placement(transformation(origin={-21.7364,0.153901},
extent={{-12.6954,-12.6954},{12.6954,12.6954}})));
  Modelica.Blocks.Interfaces.BooleanInput isPIDcontrol 
    annotation (Placement(transformation(origin={-109.156,59.9519},
extent={{-8.59767,-8.59767},{8.59767,8.59767}})));
  Modelica.Blocks.Logical.Switch switch1 
    annotation (Placement(transformation(origin={58.933,-0.132508},
extent={{-10,-10},{10,10}})));
  Modelica.Blocks.Interfaces.RealOutput controlSignal 
    annotation (Placement(transformation(origin={109.967,-0.0914117},
extent={{-10,-10},{10,10}})));
  Modelica.Blocks.Interfaces.RealInput manualOpening 
    annotation (Placement(transformation(origin={-109.398,39.7798},
extent={{-9.31564,-9.31564},{9.31564,9.31564}})));
  Modelica.Blocks.Interfaces.RealInput setPoint 
    annotation (Placement(transformation(origin={-109.3,-0.00083086},
extent={{-9.50308,-9.50308},{9.50308,9.50308}})));
  Modelica.Blocks.Interfaces.RealInput measure 
    annotation (Placement(transformation(origin={0.0888651,-110.682},
extent={{-9.87797,-9.87797},{9.87797,9.87797}},
rotation=90)));
  equation
  connect(isPIDcontrol, switch1.u2) 
  annotation(Line(origin={-20,35},
points={{-89.1559,24.9519},{31.847,24.9519},{31.847,-35.132508},{66.933,-35.132508}},
color={255,0,255}));
  connect(switch1.y, controlSignal) 
  annotation(Line(origin={85,0},
points={{-15.067,-0.132508},{24.9674,-0.0914117}},
color={0,0,127}));
  connect(manualOpening, switch1.u3) 
  annotation(Line(origin={-27,14},
points={{-82.3982,25.7798},{47.6471,25.7798},{47.6471,-22.132508},{73.933,-22.132508}},
color={0,0,127}));
  connect(PID.y, switch1.u1) 
  annotation(Line(origin={22,5},
points={{-29.7715,-4.8461},{-14.8674,-4.8461},{-14.8674,2.86749},{24.933,2.86749}},
color={0,0,127}));
  connect(setPoint, PID.u_s) 
  annotation(Line(origin={-79,0},
points={{-30.2998,-0.00083086},{42.02912,-0.00083086},{42.02912,0.153901}},
color={0,0,127}));
  connect(PID.u_m, measure) 
  annotation(Line(origin={-21,-58},
points={{-0.7364,42.919421},{-0.7364,-15.288},{21.0889,-15.288},{21.0889,-52.6817}},
color={0,0,127}));
  end Model_SyncPIDController;